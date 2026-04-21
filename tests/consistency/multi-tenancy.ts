// Multi-tenancy consistency check (T2.1).
//
// Scans every Rust source file under `backend/src/` for SQL statements
// touching tenant-scoped tables and asserts each query scopes by
// `user_id` (or — for `session_events` — both `user_id` AND `session_id`).
//
// The canonical exception is `processed_webhooks` (documented in
// `backend/AGENTS.md` §2): webhooks arrive before we resolve a tenant, so
// the table deliberately omits `user_id` from its PK. This check does NOT
// enforce `WHERE user_id` on `processed_webhooks`.
//
// Bypass mechanism: if a specific query is intentionally cross-tenant
// (e.g. a recovery sweep), add a comment `// allow-filter: <reason>`
// within 3 lines of the SQL literal and it will be excluded.

import { readFileSync } from 'fs'
import { glob } from 'glob'
import path from 'path'

const ROOT = path.resolve(import.meta.dirname, '../..')

// Tables that MUST be scoped by `user_id`. `session_events` additionally
// requires `session_id` (its partition key is composite: (user_id, session_id)).
const TENANT_TABLES = [
  'sessions',
  'session_events',
  'messages',
  'llm_call_logs',
  'conversations',
] as const

// Exempt tables. Each must be documented in `backend/AGENTS.md`.
const EXEMPT_TABLES = new Set<string>([
  'processed_webhooks',
])

type Offense = {
  file: string
  line: number
  table: string
  excerpt: string
  reason: string
}

function stripKeyspacePrefix(table: string): string {
  // Strip `inertial_eclipse.` prefix if present.
  const dot = table.lastIndexOf('.')
  return dot >= 0 ? table.substring(dot + 1) : table
}

/**
 * Extract SQL operations from a Rust source file. We capture every DML/DDL
 * literal (`SELECT` / `INSERT` / `UPDATE` / `DELETE`) together with the
 * table name it touches.
 */
function extractQueries(file: string, content: string): Array<{
  line: number
  verb: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE'
  table: string
  text: string
}> {
  const results: Array<{
    line: number
    verb: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE'
    table: string
    text: string
  }> = []

  // Split content into character indices -> line numbers for fast lookup
  const lineStarts: number[] = [0]
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') lineStarts.push(i + 1)
  }
  const indexToLine = (idx: number): number => {
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1
      if (lineStarts[mid] <= idx) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }

  // Match SELECT/INSERT/UPDATE/DELETE at the start of a string literal body.
  // We look at the contiguous string body (the " that opens a Rust string)
  // and scan forward to find the matching close " (skipping escapes). This
  // handles multi-line Rust raw-ish strings and simple backslash escapes.
  const startRegex =
    /(SELECT\s+|INSERT\s+INTO\s+|UPDATE\s+|DELETE\s+FROM\s+)/gi

  let m: RegExpExecArray | null
  while ((m = startRegex.exec(content)) !== null) {
    const verbStart = m.index
    // Walk back to find the opening `"` of this string literal. Abort if we
    // hit a line starting with `//` or are outside a string.
    let openQuote = -1
    for (let i = verbStart - 1; i >= 0 && i >= verbStart - 5000; i--) {
      const ch = content[i]
      if (ch === '"' && content[i - 1] !== '\\') {
        openQuote = i
        break
      }
      if (ch === '\n') {
        // String should be on the same chunk — if we cross a newline then
        // open quote, that's still OK; keep scanning back.
      }
    }
    if (openQuote < 0) continue

    // Find the closing quote.
    let closeQuote = -1
    for (let i = verbStart; i < content.length; i++) {
      const ch = content[i]
      if (ch === '\\') {
        i++ // skip escape
        continue
      }
      if (ch === '"') {
        closeQuote = i
        break
      }
    }
    if (closeQuote < 0) continue

    const body = content.substring(openQuote + 1, closeQuote)

    // Figure out the verb.
    const verbUpper = m[1].trim().toUpperCase()
    let verb: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE'
    if (verbUpper.startsWith('SELECT')) verb = 'SELECT'
    else if (verbUpper.startsWith('INSERT')) verb = 'INSERT'
    else if (verbUpper.startsWith('UPDATE')) verb = 'UPDATE'
    else verb = 'DELETE'

    // Extract the table name.
    let tableMatch: RegExpMatchArray | null = null
    if (verb === 'SELECT') {
      tableMatch = body.match(/FROM\s+([A-Za-z0-9_.]+)/i)
    } else if (verb === 'INSERT') {
      tableMatch = body.match(/INSERT\s+INTO\s+([A-Za-z0-9_.]+)/i)
    } else if (verb === 'UPDATE') {
      tableMatch = body.match(/UPDATE\s+([A-Za-z0-9_.]+)/i)
    } else if (verb === 'DELETE') {
      tableMatch = body.match(/DELETE\s+FROM\s+([A-Za-z0-9_.]+)/i)
    }
    if (!tableMatch) continue

    const table = stripKeyspacePrefix(tableMatch[1])
    results.push({
      line: indexToLine(openQuote),
      verb,
      table,
      text: body,
    })
  }

  return results
}

function hasAllowFilterBypass(content: string, lineNumber: number): boolean {
  // Scan up to 5 lines before and 3 after the quote-open line for a bypass
  // comment (`// allow-filter: ...`). `lineNumber` is 1-based; `lines` is
  // 0-indexed, so subtract 1 when converting to an index. We look slightly
  // wider above because a multi-line comment can push the `// allow-filter:`
  // line a few rows above the `db.query_unpaged(...)` call.
  const lines = content.split('\n')
  const zeroBased = lineNumber - 1
  const start = Math.max(0, zeroBased - 5)
  const end = Math.min(lines.length - 1, zeroBased + 3)
  for (let i = start; i <= end; i++) {
    if (/\/\/\s*allow-filter\s*:/i.test(lines[i])) return true
  }
  return false
}

function main() {
  const files = glob.sync('backend/src/**/*.rs', {
    cwd: ROOT,
    ignore: ['**/target/**'],
  })

  const offenses: Offense[] = []
  const stats: Record<string, number> = {}

  for (const relFile of files) {
    const absFile = path.join(ROOT, relFile)
    const content = readFileSync(absFile, 'utf-8')
    const queries = extractQueries(relFile, content)

    for (const q of queries) {
      if (!TENANT_TABLES.includes(q.table as (typeof TENANT_TABLES)[number])) {
        continue
      }
      if (EXEMPT_TABLES.has(q.table)) continue

      stats[q.table] = (stats[q.table] || 0) + 1

      const body = q.text
      const hasUserId = /\bWHERE\b[^;]*\buser_id\s*=\s*\?/i.test(body)
        // INSERTs use a column list, not a WHERE; require `user_id` in the
        // column list instead.
        || (q.verb === 'INSERT' && /\buser_id\b/i.test(body))

      if (!hasUserId) {
        if (hasAllowFilterBypass(content, q.line)) continue
        offenses.push({
          file: relFile,
          line: q.line,
          table: q.table,
          excerpt: body.substring(0, 120).replace(/\s+/g, ' '),
          reason: `missing WHERE user_id / user_id column`,
        })
        continue
      }

      // `session_events` additionally requires `session_id` filtering.
      if (q.table === 'session_events' && q.verb !== 'INSERT') {
        const hasSessionId = /\bWHERE\b[^;]*\bsession_id\s*=\s*\?/i.test(body)
        if (!hasSessionId) {
          if (hasAllowFilterBypass(content, q.line)) continue
          offenses.push({
            file: relFile,
            line: q.line,
            table: q.table,
            excerpt: body.substring(0, 120).replace(/\s+/g, ' '),
            reason: `session_events requires WHERE user_id AND session_id`,
          })
        }
      }
    }
  }

  console.log('--- Multi-Tenancy Scan ---')
  console.log(
    `Tables checked: ${TENANT_TABLES.join(', ')} (exempt: ${[...EXEMPT_TABLES].join(', ')})`,
  )
  console.log(`Queries scanned per tenant table:`)
  for (const [table, count] of Object.entries(stats).sort()) {
    console.log(`  ${table}: ${count}`)
  }
  console.log('')

  if (offenses.length === 0) {
    console.log('PASS: every tenant-scoped query filters by user_id')
    console.log(
      '  sessions queries use WHERE user_id; session_events queries use WHERE user_id AND session_id.',
    )
    process.exit(0)
  }

  console.log(`FAIL: ${offenses.length} query(ies) miss tenant scoping:`)
  for (const o of offenses) {
    console.log(`  ${o.file}:${o.line}  [${o.table}]  ${o.reason}`)
    console.log(`    ${o.excerpt}`)
  }
  process.exit(1)
}

main()
