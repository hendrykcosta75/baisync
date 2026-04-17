<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Design system enforcement

BEFORE editing or creating ANY `.tsx` / `.ts` / `.css` file under this directory, invoke the `ui-design` skill. No exceptions — even bugfixes that touch markup. That skill is the source of truth for:

- Fonts: `'JetBrains Mono', 'Fira Code', monospace` inline on every heading/label.
- Dashboard buttons: `btn-neu` / `btn-neu-ghost` from `globals.css` — **never** `<Button>` from `@heroui/react` inside `app/dashboard/**` or non-landing `components/**`.
- Semantic color tokens: `bg-app`, `bg-surface`, `bg-raised`, `bg-overlay`, `bg-dim`, `text-heading`, `text-body`, `text-subtle`, `border-dim` — never raw hex for surfaces/text.
- Round neumorphic controls for floating/video actions (see section 6.1 of the skill).
