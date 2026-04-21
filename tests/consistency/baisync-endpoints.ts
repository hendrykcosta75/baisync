import { readFileSync } from 'fs'
import path from 'path'

const ROOT = path.resolve(import.meta.dirname, '../..')

// S1.3 — minimum-viable consistency check for Sophie self-introspection
// actions. The broader action↔endpoint validation (every action name in
// system.md resolves to either a REST endpoint, a client-side whitelist, or
// a Sophie-only endpoint) is left as a TODO — the plan defines the pragmatic
// simpler version: assert that the two new actions `get_my_recent_errors`
// and `get_platform_health` appear BOTH in system.md AND in app.rs.

// TODO(S2.x): Extend this check to validate every `- action_name: data:`
// line in resources/sophie/system.md against either:
//   (a) a matching REST endpoint in app.rs by naming convention
//       (e.g. list_assistants → /api/assistants)
//   (b) a small whitelist of client-side-only actions
//       (e.g. switch_workspace)
//   (c) a Sophie-only endpoint under /api/baisync/actions/
// For now we only guard the two S1.3 additions.

const REQUIRED_ACTIONS: { action: string; route: string }[] = [
  {
    action: 'get_my_recent_errors',
    route: '/api/baisync/actions/my_recent_errors',
  },
  {
    action: 'get_platform_health',
    route: '/api/baisync/actions/platform_health',
  },
]

function extractSystemMdActions(): Set<string> {
  const content = readFileSync(
    path.join(ROOT, 'backend/resources/sophie/system.md'),
    'utf-8',
  )
  const actions = new Set<string>()
  // Lines like "- action_name: data: {{...}} (description)"
  const actionRegex = /^-\s+([a-z_][a-z0-9_]*)\s*:\s*data\s*:/gm
  let match
  while ((match = actionRegex.exec(content)) !== null) {
    actions.add(match[1])
  }
  return actions
}

function extractBackendRoutes(): Set<string> {
  const appRs = readFileSync(path.join(ROOT, 'backend/src/app.rs'), 'utf-8')
  const routeRegex = /\.route\(\s*"([^"]+)"/g
  const routes = new Set<string>()
  let match
  while ((match = routeRegex.exec(appRs)) !== null) {
    routes.add(match[1])
  }
  return routes
}

function main() {
  const actions = extractSystemMdActions()
  const routes = extractBackendRoutes()

  console.log(`Actions documented in system.md: ${actions.size}`)
  console.log(`Backend routes in app.rs: ${routes.size}`)
  console.log('')

  let errors = 0

  for (const { action, route } of REQUIRED_ACTIONS) {
    if (!actions.has(action)) {
      console.log(
        `ERROR: Sophie action "${action}" missing from backend/resources/sophie/system.md`,
      )
      errors++
    }
    if (!routes.has(route)) {
      console.log(
        `ERROR: Route "${route}" missing from backend/src/app.rs`,
      )
      errors++
    }
    if (actions.has(action) && routes.has(route)) {
      console.log(`OK: ${action} <-> ${route}`)
    }
  }

  console.log('')
  if (errors > 0) {
    console.log(`FAIL: ${errors} missing baisync endpoint/action pair(s)`)
    process.exit(1)
  }
  console.log('PASS: Sophie self-introspection actions are wired end-to-end')
}

main()
