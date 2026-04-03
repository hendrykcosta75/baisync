---
name: ui-design
description: TRIGGER when creating new components, pages, modals, cards, forms, or any visual UI element in the frontend. Also when refactoring existing components for better visual quality.

---

## Design System Reference

### Brand Identity

- **Primary accent**: `#FF6B00` (orange) — used for CTAs, active states, indicators, glows
- **Accent hover**: `#ff8533`
- **Design philosophy**: Dark-first, minimal, glassmorphic, factory.ai-inspired

### Color Tokens (use these, NOT raw hex values)

Use semantic Tailwind classes mapped to CSS variables:

| Token         | Tailwind Class   | Dark Mode         | Light Mode     | Usage                        |
|---------------|------------------|-------------------|----------------|------------------------------|
| `app`         | `bg-app`         | `#050505`         | `#EEF2F7`      | Page background              |
| `surface`     | `bg-surface`     | `#0A0A0A`         | `#F5F7FB`      | Card/panel backgrounds       |
| `raised`      | `bg-raised`      | `#111111`         | `#E4E9F2`      | Elevated surfaces            |
| `overlay`     | `bg-overlay`     | `#141414`         | `#F5F7FB`      | Modals, popovers             |
| `dim`         | `bg-dim`         | `#1A1A1A`         | `#D0D8E8`      | Dividers, subtle backgrounds |
| `dim-hover`   | `bg-dim-hover`   | `#252525`         | `#B8C3D9`      | Hover state for dim          |
| `heading`     | `text-heading`   | `#EDF0F7`         | `#0C1631`      | Headings, titles             |
| `body`        | `text-body`      | `#C4CCDF`         | `#2A3556`      | Body text                    |
| `subtle`      | `text-subtle`    | `#8892B0`         | `#5C6A8A`      | Secondary text, labels       |

### Typography

- **Body font**: Geist Sans (`font-sans` or default)
- **Monospace/branded font**: JetBrains Mono — use for headings, nav labels, badges, code
  ```tsx
  style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
  ```
- **Font sizes**: 11-16px for UI labels, standard Tailwind scale for content
- **Font weights**: 500 (normal UI), 600-700 (emphasis), 800 (hero headings)
- **Font smoothing**: Always applied globally via `antialiased`

### Icons

- **Library**: `lucide-react` — ALWAYS use this, never other icon libraries
- **Standard sizes**: `size={16}` for inline, `size={20}` for standalone, `size={24}` for hero
- **Color**: Inherit from parent text color (`currentColor`)
```tsx
import { Bot, Settings, Plus } from 'lucide-react'
<Bot size={16} />
```

## Component Patterns

### HeroUI v3 — Mandatory Rules

1. **Read** `frontend/.agents/skills/heroui-react/SKILL.md` before using any HeroUI component
2. Use **compound components** with dot-notation:
   ```tsx
   <Card>
     <Card.Header>...</Card.Header>
     <Card.Content>...</Card.Content>
     <Card.Footer>...</Card.Footer>
   </Card>
   ```
3. Use `onPress` instead of `onClick` on all HeroUI interactive components
4. Do **NOT** use `HeroUIProvider` — v3 does not need it
5. Do **NOT** use `framer-motion` — v3 uses CSS animations natively

### Card Pattern

```tsx
<div className="bg-surface border border-dim rounded-xl p-5 transition-all duration-300 hover:border-dim-hover hover:shadow-lg hover:shadow-[rgba(255,107,0,0.05)]">
  <div className="flex items-center gap-3 mb-3">
    <div className="w-9 h-9 rounded-lg bg-raised flex items-center justify-center">
      <Bot size={18} className="text-[#FF6B00]" />
    </div>
    <h3 className="text-heading text-sm font-semibold" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
      Title
    </h3>
  </div>
  <p className="text-body text-sm leading-relaxed">Description text here.</p>
</div>
```

### Glassmorphism Panel

```tsx
<div className="glass-panel border border-dim rounded-xl p-6">
  {/* In dark mode: rgba(10,10,10,0.65) + backdrop-blur(20px) */}
</div>
```

### Button Patterns

```tsx
{/* Primary CTA — Orange accent */}
<Button
  variant="solid"
  onPress={handleAction}
  className="bg-[#FF6B00] hover:bg-[#ff8533] text-white font-medium text-sm rounded-lg px-4 py-2 transition-colors duration-200"
  style={{ fontFamily: "'JetBrains Mono', monospace" }}
>
  <Plus size={16} />
  Create
</Button>

{/* Ghost/Subtle */}
<Button
  variant="ghost"
  onPress={handleAction}
  className="text-subtle hover:text-heading hover:bg-dim transition-colors duration-200 rounded-lg px-3 py-2 text-sm"
>
  Cancel
</Button>
```

### Form Fields

Always use React Hook Form + Zod. Style inputs to match the dark theme:

```tsx
<TextField>
  <Label className="text-subtle text-xs font-medium mb-1.5 block" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
    Label
  </Label>
  <Input
    className="bg-raised border border-dim rounded-lg px-3 py-2.5 text-body text-sm placeholder:text-subtle/50 focus:border-[#FF6B00]/50 focus:ring-1 focus:ring-[#FF6B00]/20 transition-all duration-200 outline-none w-full"
    placeholder="Placeholder..."
    {...field}
  />
  <FieldError className="text-red-400 text-xs mt-1" />
</TextField>
```

## Animations

### Available CSS Animation Classes

Use these existing utility classes defined in `globals.css`:

| Class                    | Effect                                           | Duration |
|--------------------------|--------------------------------------------------|----------|
| `animate-fade-in-up`    | Fade in + slide up 24px                          | 0.6s     |
| `animate-float`         | Gentle vertical float                            | 6s loop  |
| `animate-pulse-glow`    | Orange box-shadow pulse                          | 3s loop  |
| `animate-gradient-shift`| Background gradient movement                     | 8s loop  |
| `animate-pulse-dot`     | Opacity pulse for dots/indicators                | 2s loop  |
| `animate-blink`         | Cursor blinking                                  | 1s loop  |

### Staggered Entrance Animations

For lists or grids, stagger `fade-in-up` with inline `animation-delay`:

```tsx
{items.map((item, i) => (
  <div
    key={item.id}
    className="animate-fade-in-up opacity-0"
    style={{ animationDelay: `${i * 80}ms`, animationFillMode: 'forwards' }}
  >
    <ItemCard item={item} />
  </div>
))}
```

### Hover Micro-interactions

Always add smooth transitions to interactive elements:

```tsx
// Scale on hover (cards, buttons)
className="transition-transform duration-200 hover:scale-[1.02]"

// Border glow on hover
className="transition-all duration-300 hover:border-[#FF6B00]/30 hover:shadow-[0_0_20px_rgba(255,107,0,0.08)]"

// Background shift on hover
className="transition-colors duration-200 hover:bg-dim"
```

### Transition Defaults

- **Duration**: `duration-200` for micro-interactions, `duration-300` for layout changes, `duration-500` for page transitions
- **Easing**: Default (`ease`) for most, `ease-out` for entrances, `ease-in-out` for loops
- **Properties**: Always specify what transitions — use `transition-colors`, `transition-transform`, `transition-all` appropriately

## Layout Patterns

### Page Container

```tsx
<div className="max-w-6xl mx-auto px-4 lg:px-8 py-6">
  <div className="mb-6">
    <h1 className="text-heading text-xl font-bold" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
      Page Title
    </h1>
    <p className="text-subtle text-sm mt-1">Description.</p>
  </div>
  {/* Content */}
</div>
```

### Responsive Grid

```tsx
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
  {/* Cards */}
</div>
```

### Empty State

```tsx
<div className="flex flex-col items-center justify-center py-16 text-center">
  <div className="w-14 h-14 rounded-xl bg-raised flex items-center justify-center mb-4">
    <Bot size={24} className="text-subtle" />
  </div>
  <h3 className="text-heading text-base font-semibold mb-1" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
    No items yet
  </h3>
  <p className="text-subtle text-sm max-w-xs">Get started by creating your first item.</p>
</div>
```

## Visual Quality Checklist

Before finishing any component, verify:

- [ ] Uses semantic color tokens (`text-heading`, `bg-surface`, etc.), NOT raw colors
- [ ] JetBrains Mono on headings, labels, navigation, badges
- [ ] Smooth transitions on ALL interactive elements (min `duration-200`)
- [ ] Consistent border radius: `rounded-lg` (8px) for inputs/buttons, `rounded-xl` (12px) for cards/panels
- [ ] Proper spacing rhythm: 4px increments (`gap-1` to `gap-6`, `p-3` to `p-6`)
- [ ] Hover states on every clickable element
- [ ] Entrance animations on dynamically loaded content (use `animate-fade-in-up`)
- [ ] Staggered animation delays on lists/grids
- [ ] Focus states with orange accent ring (`focus:ring-[#FF6B00]/20`)
- [ ] Icons from `lucide-react` only, consistent size
- [ ] Mobile responsive (test `sm:`, `md:`, `lg:` breakpoints)
- [ ] Dark mode is the default — verify light mode also works
- [ ] No `framer-motion` imports — use CSS animations only
- [ ] `onPress` on HeroUI components, never `onClick`
