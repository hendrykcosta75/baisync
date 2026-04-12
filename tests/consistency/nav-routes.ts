import { readFileSync, existsSync } from 'fs'
import { glob } from 'glob'
import path from 'path'

const ROOT = path.resolve(import.meta.dirname, '../..')

function extractSidebarLinks(): string[] {
  const sidebarPath = path.join(ROOT, 'frontend/components/sidebar.tsx')
  if (!existsSync(sidebarPath)) {
    console.log('WARNING: sidebar.tsx not found, skipping')
    return []
  }

  const content = readFileSync(sidebarPath, 'utf-8')
  const links: string[] = []

  // Extract href values from the sidebar
  const hrefRegex = /href:\s*["']([^"']+)["']/g
  let match
  while ((match = hrefRegex.exec(content)) !== null) {
    links.push(match[1])
  }

  // Also try pattern: href="..." or to="..."
  const hrefRegex2 = /(?:href|to)=["']([^"']+)["']/g
  while ((match = hrefRegex2.exec(content)) !== null) {
    if (!links.includes(match[1])) links.push(match[1])
  }

  return links
}

function routeExists(href: string): boolean {
  // Convert /dashboard/assistants to frontend/app/dashboard/assistants/page.tsx
  const routePath = href.startsWith('/') ? href.slice(1) : href

  const possiblePaths = [
    path.join(ROOT, 'frontend/app', routePath, 'page.tsx'),
    path.join(ROOT, 'frontend/app', routePath, 'page.ts'),
    path.join(ROOT, 'frontend/app', routePath, 'page.jsx'),
    // Check inside route groups
    path.join(ROOT, 'frontend/app/(dashboard)', routePath.replace('dashboard/', ''), 'page.tsx'),
    path.join(ROOT, 'frontend/app/(dashboard)', routePath.replace('dashboard/', ''), 'page.tsx'),
  ]

  // Also check if there's a layout or any page file via glob
  const globPattern = `frontend/app/**/${routePath.split('/').pop()}/page.{tsx,ts,jsx}`
  const globMatches = glob.sync(globPattern, { cwd: ROOT })

  return possiblePaths.some(p => existsSync(p)) || globMatches.length > 0
}

function main() {
  const links = extractSidebarLinks()

  if (links.length === 0) {
    console.log('No sidebar links found to check')
    process.exit(0)
  }

  let errors = 0
  console.log(`Sidebar links found: ${links.length}`)
  console.log('')

  for (const link of links) {
    // Skip external links and anchors
    if (link.startsWith('http') || link.startsWith('#') || link === '/') continue

    if (!routeExists(link)) {
      console.log(`ERROR: Sidebar link ${link} has no corresponding page`)
      errors++
    }
  }

  console.log('')
  if (errors > 0) {
    console.log(`FAIL: ${errors} sidebar links without matching pages`)
    process.exit(1)
  }
  console.log('PASS: All sidebar links have corresponding pages')
}

main()
