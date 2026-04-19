-- Migration 088: Persist extracted text from office documents on messages
--
-- For MIME types no provider accepts inline (XLSX, XLS, DOCX), the backend
-- extracts plain text at webhook ingest and stores it here. At LLM-call time
-- the extracted text is folded into the LlmMessage content so the model can
-- answer questions about document contents — without polluting the `content`
-- column that drives the Conversations UI.
--
-- Capped by MAX_EXTRACTED_CHARS (200_000) in rag.rs. Historical messages
-- older than this migration simply have NULL here and keep working via the
-- plain-text marker injected by enrich_history_content.

USE inertial_eclipse;

ALTER TABLE messages ADD media_extracted_text text;
