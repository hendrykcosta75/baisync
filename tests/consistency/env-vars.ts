import { readFileSync } from 'fs'
import { glob } from 'glob'
import path from 'path'

const ROOT = path.resolve(import.meta.dirname, '../..')

function getEnvExampleVars(): Set<string> {
  const content = readFileSync(path.join(ROOT, '.env.example'), 'utf-8')
  const vars = new Set<string>()
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#')) {
      const name = trimmed.split('=')[0].trim()
      if (name) vars.add(name)
    }
  }
  return vars
}

function getBackendUsedVars(): Set<string> {
  const vars = new Set<string>()
  const files = glob.sync('backend/src/**/*.rs', { cwd: ROOT })

  for (const file of files) {
    const content = readFileSync(path.join(ROOT, file), 'utf-8')
    // Match env::var("VAR_NAME") or std::env::var("VAR_NAME")
    const regex = /env::var\("([^"]+)"\)/g
    let match
    while ((match = regex.exec(content)) !== null) {
      vars.add(match[1])
    }
  }
  return vars
}

function getFrontendUsedVars(): Set<string> {
  const vars = new Set<string>()
  const files = glob.sync('frontend/**/*.{ts,tsx,js}', { cwd: ROOT, ignore: ['**/node_modules/**'] })

  for (const file of files) {
    const content = readFileSync(path.join(ROOT, file), 'utf-8')
    // Match process.env.VAR or NEXT_PUBLIC_ references
    const regex = /process\.env\.([A-Z_][A-Z0-9_]*)/g
    let match
    while ((match = regex.exec(content)) !== null) {
      vars.add(match[1])
    }
  }
  return vars
}

function main() {
  const documented = getEnvExampleVars()
  const backendUsed = getBackendUsedVars()
  const frontendUsed = getFrontendUsedVars()
  const allUsed = new Set([...backendUsed, ...frontendUsed])

  let errors = 0

  console.log(`Documented in .env.example: ${documented.size}`)
  console.log(`Used in backend: ${backendUsed.size}`)
  console.log(`Used in frontend: ${frontendUsed.size}`)
  console.log('')

  // Vars used in code but not documented
  for (const v of allUsed) {
    if (!documented.has(v)) {
      // Skip common Next.js internal vars
      if (v.startsWith('NODE_') || v === 'NODE_ENV') continue
      console.log(`ERROR: ${v} used in code but not in .env.example`)
      errors++
    }
  }

  // Vars documented but not used (warnings)
  for (const v of documented) {
    if (!allUsed.has(v)) {
      console.log(`WARNING: ${v} in .env.example but not found in code`)
    }
  }

  console.log('')
  if (errors > 0) {
    console.log(`FAIL: ${errors} undocumented environment variables`)
    process.exit(1)
  }
  console.log('PASS: All used env vars are documented')
}

main()
