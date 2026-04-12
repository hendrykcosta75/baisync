import { readFileSync, existsSync } from 'fs'
import { glob } from 'glob'
import path from 'path'

const ROOT = path.resolve(import.meta.dirname, '../..')

function extractPlatformFeatures(): Set<string> {
  // Extract from frontend app routes (major feature areas)
  const features = new Set<string>()

  const pages = glob.sync('frontend/app/dashboard/*/page.tsx', { cwd: ROOT })
  for (const page of pages) {
    // Extract the route segment as a feature name
    const relative = page.replace('frontend/app/dashboard/', '').replace('/page.tsx', '')
    if (relative && !relative.includes('[')) {
      features.add(relative)
    }
  }

  return features
}

function main() {
  const features = extractPlatformFeatures()
  const agentDoc = path.join(ROOT, 'BAISYNC_AGENT.md')

  if (!existsSync(agentDoc)) {
    console.log('SKIP: BAISYNC_AGENT.md not found')
    process.exit(0)
  }

  const docContent = readFileSync(agentDoc, 'utf-8').toLowerCase()

  let warnings = 0
  console.log(`Platform features found: ${features.size}`)
  console.log('')

  for (const feature of features) {
    // Check if the feature name (or close variant) is mentioned in agent docs
    const searchTerms = feature.split('/').filter(Boolean)
    const mentioned = searchTerms.some(term =>
      docContent.includes(term.toLowerCase()) ||
      docContent.includes(term.replace('-', ' ').toLowerCase())
    )

    if (!mentioned) {
      console.log(`WARNING: Feature "${feature}" not mentioned in BAISYNC_AGENT.md`)
      warnings++
    }
  }

  console.log('')
  if (warnings > 0) {
    console.log(`${warnings} features may not be covered by Baisync Agent`)
  }
  console.log('PASS: Baisync coverage check complete')
}

main()
