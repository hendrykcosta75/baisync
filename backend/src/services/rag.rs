use chrono::{DateTime, Utc};
use scylla::frame::value::CqlTimestamp;
use uuid::Uuid;

use crate::db::DbSession;
use crate::errors::AppError;
use crate::services::encryption::EncryptionService;

const CHUNK_SIZE: usize = 1500;
const CHUNK_OVERLAP: usize = 200;

/// Cap on characters extracted from a single document. Protects against
/// spreadsheet/document exports that would blow the LLM context window.
const MAX_EXTRACTED_CHARS: usize = 200_000;
/// Per-sheet row cap to avoid a single pathological sheet eating the whole
/// char budget before other sheets are read.
const MAX_ROWS_PER_SHEET: usize = 500;
/// Security: refuse decompressing DOCX entries that claim to expand beyond this.
const MAX_DECOMPRESSED_BYTES: u64 = 50 * 1024 * 1024;

/// MIME types for which NO provider accepts the raw bytes inline but we can
/// extract plain text locally (calamine, docx parser, UTF-8). Callers use
/// this to decide whether to fold extracted text into the LLM message
/// content instead of short-circuiting with the unsupported-media reply.
///
/// MUST NOT include `application/pdf` — PDF is provider-dependent (native
/// for OpenAI/Claude/Gemini, extracted per-call for Grok/Deepseek in
/// `llm.rs`). Listing it here would regress the native path.
pub fn is_universally_text_extractable(mime: &str) -> bool {
    matches!(
        mime,
        "text/plain"
            | "text/markdown"
            | "text/csv"
            | "application/json"
            | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            | "application/vnd.ms-excel"
            | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
}

fn truncate_in_place(s: &mut String) {
    if s.len() > MAX_EXTRACTED_CHARS {
        // Split on a valid char boundary near the cap.
        let mut cut = MAX_EXTRACTED_CHARS;
        while cut > 0 && !s.is_char_boundary(cut) {
            cut -= 1;
        }
        s.truncate(cut);
        s.push_str("\n\n[... conteúdo truncado: arquivo muito grande ...]");
    }
}

/// Extract text from XLSX/XLS via calamine. Joins cells with tabs, rows with
/// newlines, and prepends a `# Planilha: <name>` header per sheet.
fn extract_xlsx(content: &[u8]) -> Result<String, AppError> {
    use calamine::{open_workbook_auto_from_rs, Data, Reader};
    use std::io::Cursor;

    let cursor = Cursor::new(content.to_vec());
    let mut wb = open_workbook_auto_from_rs(cursor)
        .map_err(|e| AppError::BadRequest(format!("Falha ao abrir planilha: {e}")))?;

    let mut out = String::new();
    let sheet_names: Vec<String> = wb.sheet_names().to_vec();

    'sheets: for name in &sheet_names {
        let Ok(range) = wb.worksheet_range(name) else {
            continue;
        };
        out.push_str("# Planilha: ");
        out.push_str(name);
        out.push('\n');

        for (row_idx, row) in range.rows().enumerate() {
            if row_idx >= MAX_ROWS_PER_SHEET {
                out.push_str("[... linhas adicionais omitidas ...]\n");
                break;
            }
            let line: Vec<String> = row
                .iter()
                .map(|c| match c {
                    Data::Empty => String::new(),
                    Data::String(s) => s.clone(),
                    Data::Float(f) => f.to_string(),
                    Data::Int(i) => i.to_string(),
                    Data::Bool(b) => b.to_string(),
                    Data::DateTime(d) => d.to_string(),
                    Data::DateTimeIso(s) | Data::DurationIso(s) => s.clone(),
                    Data::Error(e) => format!("#ERR:{e:?}"),
                })
                .collect();
            out.push_str(&line.join("\t"));
            out.push('\n');
            if out.len() >= MAX_EXTRACTED_CHARS {
                break 'sheets;
            }
        }
        out.push('\n');
    }

    if out.trim().is_empty() {
        return Err(AppError::BadRequest(
            "Planilha vazia ou ilegível".into(),
        ));
    }
    truncate_in_place(&mut out);
    Ok(out)
}

/// Extract text from DOCX by unzipping `word/document.xml` and streaming the
/// XML, concatenating `<w:t>` nodes. Paragraphs and table rows become newlines,
/// cells become tabs. Header/footer XML parts are skipped — rarely worth
/// the complexity for chat assistants.
fn extract_docx(content: &[u8]) -> Result<String, AppError> {
    use quick_xml::events::Event;
    use quick_xml::Reader as XmlReader;
    use std::io::{Cursor, Read};
    use zip::ZipArchive;

    let mut archive = ZipArchive::new(Cursor::new(content.to_vec()))
        .map_err(|e| AppError::BadRequest(format!("DOCX: arquivo inválido: {e}")))?;

    let mut doc = archive
        .by_name("word/document.xml")
        .map_err(|e| AppError::BadRequest(format!("DOCX: document.xml ausente: {e}")))?;

    if doc.size() > MAX_DECOMPRESSED_BYTES {
        return Err(AppError::BadRequest(
            "DOCX: documento excede limite de tamanho".into(),
        ));
    }

    let mut xml_bytes = Vec::new();
    doc.read_to_end(&mut xml_bytes)
        .map_err(|e| AppError::BadRequest(format!("DOCX: falha de leitura: {e}")))?;

    let mut reader = XmlReader::from_reader(xml_bytes.as_slice());
    reader.config_mut().trim_text(false);
    let mut out = String::new();
    let mut buf = Vec::new();
    let mut in_t = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => match e.name().as_ref() {
                b"w:t" => in_t = true,
                b"w:tab" => out.push('\t'),
                _ => {}
            },
            Ok(Event::End(e)) => match e.name().as_ref() {
                b"w:t" => in_t = false,
                b"w:p" => out.push('\n'),
                b"w:tc" => out.push('\t'),
                b"w:tr" => out.push('\n'),
                _ => {}
            },
            Ok(Event::Empty(e)) => match e.name().as_ref() {
                b"w:br" => out.push('\n'),
                b"w:tab" => out.push('\t'),
                _ => {}
            },
            Ok(Event::Text(t)) if in_t => {
                out.push_str(&t.decode().unwrap_or_default());
                if out.len() >= MAX_EXTRACTED_CHARS {
                    break;
                }
            }
            Ok(Event::GeneralRef(reference)) if in_t => {
                if let Ok(Some(ch)) = reference.resolve_char_ref() {
                    out.push(ch);
                } else if let Ok(name) = reference.decode() {
                    if let Some(value) = quick_xml::escape::resolve_predefined_entity(&name) {
                        out.push_str(value);
                    }
                }
                if out.len() >= MAX_EXTRACTED_CHARS {
                    break;
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => {
                return Err(AppError::BadRequest(format!("DOCX XML inválido: {e}")));
            }
            _ => {}
        }
        buf.clear();
    }

    if out.trim().is_empty() {
        return Err(AppError::BadRequest(
            "Documento vazio ou ilegível".into(),
        ));
    }
    truncate_in_place(&mut out);
    Ok(out)
}

#[allow(dead_code)]
#[derive(Debug)]
pub struct FileRecord {
    pub assistant_id: Uuid,
    pub user_id: Uuid,
    pub id: Uuid,
    pub name: String,
    pub size: i32,
    pub mime_type: String,
    pub uploaded_at: DateTime<Utc>,
}

/// Split text into overlapping chunks
fn chunk_text(text: &str, chunk_size: usize, overlap: usize) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= chunk_size {
        return vec![text.to_string()];
    }

    let mut chunks = Vec::new();
    let mut start = 0;
    while start < chars.len() {
        let end = (start + chunk_size).min(chars.len());
        let chunk: String = chars[start..end].iter().collect();
        chunks.push(chunk);
        if end >= chars.len() {
            break;
        }
        start += chunk_size - overlap;
    }
    chunks
}

/// Extract text content from uploaded file bytes
pub fn extract_text(content: &[u8], mime_type: &str) -> Result<String, AppError> {
    match mime_type {
        "text/plain" | "text/markdown" | "text/csv" | "application/json" => {
            String::from_utf8(content.to_vec())
                .map_err(|e| AppError::BadRequest(format!("Invalid UTF-8: {e}")))
        }
        "application/pdf" => {
            // Simple PDF text extraction — look for text between stream markers
            // For production, use a proper PDF library
            let raw = String::from_utf8_lossy(content);
            let text: String = raw
                .lines()
                .filter(|l| !l.starts_with('%') && !l.contains("obj") && !l.contains("endobj"))
                .filter(|l| {
                    l.chars()
                        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
                        .count()
                        > l.len() / 2
                })
                .collect::<Vec<_>>()
                .join("\n");
            if text.trim().is_empty() {
                Err(AppError::BadRequest(
                    "Could not extract text from PDF. Try uploading as TXT.".into(),
                ))
            } else {
                Ok(text)
            }
        }
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        | "application/vnd.ms-excel" => extract_xlsx(content),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => {
            extract_docx(content)
        }
        _ => Err(AppError::BadRequest(format!(
            "Unsupported file type: {mime_type}"
        ))),
    }
}

/// Upload a file: extract text, chunk, store in Cassandra
pub async fn upload_file(
    db: &DbSession,
    _encryption: &EncryptionService,
    user_id: &Uuid,
    assistant_id: &Uuid,
    file_name: &str,
    file_bytes: &[u8],
    mime_type: &str,
) -> Result<FileRecord, AppError> {
    let content_text = extract_text(file_bytes, mime_type)?;
    let chunks = chunk_text(&content_text, CHUNK_SIZE, CHUNK_OVERLAP);
    let now = CqlTimestamp(Utc::now().timestamp_millis());
    let file_id = Uuid::new_v4();

    for (i, chunk) in chunks.iter().enumerate() {
        let chunk_id = if i == 0 { file_id } else { Uuid::new_v4() };
        let chunk_name = if chunks.len() == 1 {
            file_name.to_string()
        } else {
            format!("{} [part {}]", file_name, i + 1)
        };

        db.query_unpaged(
            "INSERT INTO inertial_eclipse.assistant_files (assistant_id, user_id, id, name, size, mime_type, content_text, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (assistant_id, user_id, &chunk_id, &chunk_name as &str, file_bytes.len() as i32, mime_type, chunk.as_str(), now),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }

    Ok(FileRecord {
        assistant_id: *assistant_id,
        user_id: *user_id,
        id: file_id,
        name: file_name.to_string(),
        size: file_bytes.len() as i32,
        mime_type: mime_type.to_string(),
        uploaded_at: Utc::now(),
    })
}

/// List files for an assistant (deduplicated by base name)
pub async fn list_files(
    db: &DbSession,
    assistant_id: &Uuid,
    user_id: &Uuid,
) -> Result<Vec<FileRecord>, AppError> {
    let result = db
        .query_unpaged(
            "SELECT assistant_id, user_id, id, name, size, mime_type, uploaded_at FROM inertial_eclipse.assistant_files WHERE assistant_id = ? AND user_id = ?",
            (assistant_id, user_id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let mut files = Vec::new();
    let mut seen_names = std::collections::HashSet::new();

    let rows = result.into_rows_result()?;
    for row in rows.rows::<(Uuid, Uuid, Uuid, String, i32, String, DateTime<Utc>)>()? {
        let r = row.map_err(|e| AppError::DatabaseError(e.to_string()))?;
        // Deduplicate chunks — only show base file name
        let base_name = r.3.split(" [part ").next().unwrap_or(&r.3).to_string();
        if seen_names.insert(base_name.clone()) {
            files.push(FileRecord {
                assistant_id: r.0,
                user_id: r.1,
                id: r.2,
                name: base_name,
                size: r.4,
                mime_type: r.5,
                uploaded_at: r.6,
            });
        }
    }

    Ok(files)
}

/// Delete all chunks of a file
pub async fn delete_file(
    db: &DbSession,
    assistant_id: &Uuid,
    user_id: &Uuid,
    file_id: &Uuid,
) -> Result<(), AppError> {
    // Get the file name first to find all chunks
    let result = db
        .query_unpaged(
            "SELECT name FROM inertial_eclipse.assistant_files WHERE assistant_id = ? AND user_id = ? AND id = ?",
            (assistant_id, user_id, file_id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let name = result
        .into_rows_result()
        .ok()
        .and_then(|r| r.single_row::<(String,)>().ok())
        .map(|r| r.0)
        .unwrap_or_default();

    let base_name = name.split(" [part ").next().unwrap_or(&name);

    // Find all chunks with this base name
    let all = db
        .query_unpaged(
            "SELECT id, name FROM inertial_eclipse.assistant_files WHERE assistant_id = ? AND user_id = ?",
            (assistant_id, user_id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let all_rows = all.into_rows_result()?;
    for row in all_rows.rows::<(Uuid, String)>()? {
        let (chunk_id, chunk_name) = row.map_err(|e| AppError::DatabaseError(e.to_string()))?;
        let chunk_base = chunk_name.split(" [part ").next().unwrap_or(&chunk_name);
        if chunk_base == base_name {
            db.query_unpaged(
                "DELETE FROM inertial_eclipse.assistant_files WHERE assistant_id = ? AND user_id = ? AND id = ?",
                (assistant_id, user_id, &chunk_id),
            )
            .await
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;
        }
    }

    Ok(())
}

/// Retrieve relevant context from knowledge base
pub async fn retrieve_context(
    db: &DbSession,
    _encryption: &EncryptionService,
    user_id: &Uuid,
    assistant_id: &Uuid,
    _query: &str,
    limit: i32,
) -> Result<Vec<String>, AppError> {
    let result = db
        .query_unpaged(
            "SELECT content_text FROM inertial_eclipse.assistant_files WHERE assistant_id = ? AND user_id = ?",
            (assistant_id, user_id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let mut contexts = Vec::new();
    let rows = result.into_rows_result()?;
    for row in rows.rows::<(String,)>()? {
        let (text,) = row.map_err(|e| AppError::DatabaseError(e.to_string()))?;
        if !text.trim().is_empty() {
            contexts.push(text);
            if contexts.len() >= limit as usize {
                break;
            }
        }
    }

    Ok(contexts)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    const XLSX_MIME: &str =
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const DOCX_MIME: &str =
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    #[test]
    fn is_universally_text_extractable_covers_all_expected_mimes() {
        assert!(is_universally_text_extractable("text/plain"));
        assert!(is_universally_text_extractable("text/markdown"));
        assert!(is_universally_text_extractable("text/csv"));
        assert!(is_universally_text_extractable("application/json"));
        assert!(is_universally_text_extractable(XLSX_MIME));
        assert!(is_universally_text_extractable(
            "application/vnd.ms-excel"
        ));
        assert!(is_universally_text_extractable(DOCX_MIME));
    }

    #[test]
    fn is_universally_text_extractable_rejects_provider_dependent_and_native() {
        // PDF is provider-dependent (not universal) — must NOT be listed.
        assert!(!is_universally_text_extractable("application/pdf"));
        // Native inline types stay out.
        assert!(!is_universally_text_extractable("image/jpeg"));
        assert!(!is_universally_text_extractable("image/png"));
        assert!(!is_universally_text_extractable("video/mp4"));
        // Random stuff.
        assert!(!is_universally_text_extractable(
            "application/octet-stream"
        ));
        assert!(!is_universally_text_extractable(""));
    }

    /// Build a minimal XLSX in memory with three named sheets and write a few
    /// cells, then read it back through extract_xlsx.
    #[test]
    fn extract_xlsx_roundtrip_basic() {
        use zip::write::SimpleFileOptions;
        use zip::ZipWriter;

        // Use rust_xlsxwriter? Not a dep. Instead build the tiniest valid xlsx
        // by hand: a zip with [Content_Types].xml, _rels/.rels, xl/workbook.xml,
        // xl/_rels/workbook.xml.rels, xl/worksheets/sheet1.xml.
        let mut buf: Vec<u8> = Vec::new();
        {
            let mut zw = ZipWriter::new(std::io::Cursor::new(&mut buf));
            let opts =
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

            use std::io::Write;
            zw.start_file("[Content_Types].xml", opts).unwrap();
            zw.write_all(br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>"#).unwrap();

            zw.start_file("_rels/.rels", opts).unwrap();
            zw.write_all(br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>"#).unwrap();

            zw.start_file("xl/workbook.xml", opts).unwrap();
            zw.write_all(br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Dados" sheetId="1" r:id="rId1"/></sheets>
</workbook>"#).unwrap();

            zw.start_file("xl/_rels/workbook.xml.rels", opts).unwrap();
            zw.write_all(br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>"#).unwrap();

            zw.start_file("xl/worksheets/sheet1.xml", opts).unwrap();
            zw.write_all(br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><t>Nome</t></is></c><c r="B1" t="inlineStr"><is><t>Idade</t></is></c></row>
<row r="2"><c r="A2" t="inlineStr"><is><t>Ana</t></is></c><c r="B2"><v>30</v></c></row>
<row r="3"><c r="A3" t="inlineStr"><is><t>Bob</t></is></c><c r="B3"><v>25</v></c></row>
</sheetData>
</worksheet>"#).unwrap();

            zw.finish().unwrap();
        }

        let out = extract_text(&buf, XLSX_MIME).expect("extract_xlsx failed");
        assert!(out.contains("# Planilha: Dados"), "sheet header missing: {out}");
        assert!(out.contains("Nome"), "header row missing: {out}");
        assert!(out.contains("Ana"), "row 2 missing: {out}");
        assert!(out.contains("Bob"), "row 3 missing: {out}");
    }

    #[test]
    fn extract_docx_basic_paragraphs_and_table() {
        use zip::write::SimpleFileOptions;
        use zip::ZipWriter;

        let mut buf: Vec<u8> = Vec::new();
        {
            let mut zw = ZipWriter::new(std::io::Cursor::new(&mut buf));
            let opts =
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

            use std::io::Write;
            zw.start_file("word/document.xml", opts).unwrap();
            zw.write_all(
                br#"<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:p><w:r><w:t>Primeiro &amp; paragrafo</w:t></w:r></w:p>
<w:p><w:r><w:t>Segundo paragrafo</w:t></w:r></w:p>
<w:tbl>
<w:tr>
<w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc>
<w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc>
</w:tr>
</w:tbl>
</w:body>
</w:document>"#,
            )
            .unwrap();
            zw.finish().unwrap();
        }

        let out = extract_text(&buf, DOCX_MIME).expect("extract_docx failed");
        assert!(out.contains("Primeiro & paragrafo"), "p1 missing: {out}");
        assert!(out.contains("Segundo paragrafo"), "p2 missing: {out}");
        assert!(out.contains("A1"), "table cell A1 missing: {out}");
        assert!(out.contains("B1"), "table cell B1 missing: {out}");
        assert!(out.contains('\t'), "expected tab between table cells: {out:?}");
    }

    #[test]
    fn extract_docx_rejects_corrupt_bytes() {
        let err = extract_text(b"this is not a zip", DOCX_MIME);
        assert!(matches!(err, Err(AppError::BadRequest(_))));
    }

    #[test]
    fn extract_text_still_supports_plain_text() {
        let out = extract_text(b"hello world", "text/plain").unwrap();
        assert_eq!(out, "hello world");
    }
}
