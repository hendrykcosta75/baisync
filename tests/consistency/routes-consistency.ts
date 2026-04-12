import { readFileSync } from 'fs'
import { glob } from 'glob'
import path from 'path'

const ROOT = path.resolve(import.meta.dirname, '../..')

function extractBackendRoutes(): Set<string> {
  const appRs = readFileSync(path.join(ROOT, 'backend/src/app.rs'), 'utf-8')
  const routeRegex = /\.route\(\s*"([^"]+)"/g
  const routes = new Set<string>()
  let match
  while ((match = routeRegex.exec(appRs)) !== null) {
    // Normalize {param} to :param
    const normalized = match[1].replace(/\{[^}]+\}/g, ':param')
    routes.add(normalized)
  }
  return routes
}

function extractFrontendApiCalls(): Set<string> {
  const calls = new Set<string>()

  const files = glob.sync('frontend/{store,lib,components,app}/**/*.{ts,tsx}', { cwd: ROOT, ignore: ['**/node_modules/**'] })

  for (const file of files) {
    const content = readFileSync(path.join(ROOT, file), 'utf-8')
    // Match patterns like: `/api/...` or `"/api/..."` or apiFetch(`/api/...`)
    const urlRegex = /[`"']\/api\/[^`"'\s]+[`"']/g
    let match
    while ((match = urlRegex.exec(content)) !== null) {
      let url = match[0].replace(/[`"']/g, '')
      // Remove query params (both literal ? and template expressions that are query strings)
      url = url.split('?')[0]
      // Remove trailing template expressions that are query params (e.g. ${shareQs})
      // These don't start with / so they're appended to the last segment
      url = url.replace(/\$\{[^}]*[Qq]s[^}]*\}/g, '')
      url = url.replace(/\$\{[^}]*[Qq]uery[^}]*\}/g, '')
      url = url.replace(/\$\{[^}]*[Pp]aram[^}]*\}/g, '')
      // Normalize path-segment template expressions ${...} to :param
      // Only replace when preceded by /
      url = url.replace(/\/\$\{[^}]+\}/g, '/:param')
      // Remove any remaining template expressions (likely query strings appended without ?)
      url = url.replace(/\$\{[^}]+\}/g, '')
      // Clean up trailing slashes and double slashes
      url = url.replace(/\/\//g, '/')
      url = url.replace(/\/$/, '')
      if (url) calls.add(url)
    }
  }
  return calls
}

// Routes that are only called from external systems (webhooks) or internal
const BACKEND_EXCEPTIONS = new Set([
  '/api/webhooks/baileys/:param',
  '/api/webhooks/meta',
  '/api/webhooks/telegram/:param',
  '/api/webhooks/mercadopago',
  '/api/webhooks/stripe',
  '/api/webhooks/mercadopago/card',
  '/health',
])

// Frontend-only API routes (Next.js route handlers, not backend calls)
const FRONTEND_ONLY_ROUTES = new Set([
  '/api/auth/logout',
  '/api/admin/logout',
  '/api/health',
])

function main() {
  const backendRoutes = extractBackendRoutes()
  const frontendCalls = extractFrontendApiCalls()

  let errors = 0
  let warnings = 0

  console.log(`Backend routes found: ${backendRoutes.size}`)
  console.log(`Frontend API calls found: ${frontendCalls.size}`)
  console.log('')

  // Check frontend calls against backend
  for (const call of frontendCalls) {
    if (FRONTEND_ONLY_ROUTES.has(call)) continue
    if (!backendRoutes.has(call)) {
      // Check if it matches with different param names
      const callParts = call.split('/')
      let found = false
      for (const route of backendRoutes) {
        const routeParts = route.split('/')
        if (routeParts.length === callParts.length) {
          const matches = routeParts.every((part, i) =>
            part === callParts[i] || part === ':param' || callParts[i] === ':param'
          )
          if (matches) { found = true; break }
        }
      }
      if (!found) {
        console.log(`ERROR: Frontend calls ${call} but no matching backend route`)
        errors++
      }
    }
  }

  // Check backend routes without frontend callers (warnings only)
  for (const route of backendRoutes) {
    if (BACKEND_EXCEPTIONS.has(route)) continue

    let found = false
    for (const call of frontendCalls) {
      const routeParts = route.split('/')
      const callParts = call.split('/')
      if (routeParts.length === callParts.length) {
        const matches = routeParts.every((part, i) =>
          part === callParts[i] || part === ':param' || callParts[i] === ':param'
        )
        if (matches) { found = true; break }
      }
    }
    if (!found) {
      console.log(`WARNING: Backend route ${route} has no frontend caller`)
      warnings++
    }
  }

  console.log('')
  console.log(`Results: ${errors} errors, ${warnings} warnings`)

  if (errors > 0) {
    process.exit(1)
  }
}

main()
