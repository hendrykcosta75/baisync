---
name: ui-design
description: TRIGGER on ANY frontend change — new or edited .tsx/.ts/.css file under `frontend/`. Invoke BEFORE writing the first line of code for components, pages, modals, cards, forms, widgets, restyles, refactors, or bug-fixes that touch markup/styles. If you are about to edit anything visual in the dashboard, you MUST have invoked this skill first.

---

# Design System — Baisync

## 1. Design Principles

- **Dark-first, neumorphic**: Dark surfaces with depth created by inset/outset shadows, not flat Material or outlined styles.
- **Orange accent ecosystem**: `#ff6b2c` is the single brand color. Every interactive, active, or highlighted element derives from it via opacity scales.
- **Glassmorphism for navigation**: Headers, sidebars, and overlays use `backdrop-filter: blur()` over semi-transparent backgrounds.
- **Subtle motion, never distracting**: Animations serve orientation (entrance, feedback) — never decorative loops on primary content.

---

## 2. Color System

### 2.1 Semantic Surface Tokens

These are defined as CSS variables in `globals.css` and mapped to Tailwind via `@theme`. **Always use these classes, never raw hex.**

| Token       | Tailwind Class  | Dark Mode   | Light Mode  | Usage                         |
|-------------|-----------------|-------------|-------------|-------------------------------|
| `app`       | `bg-app`        | `#0a0a0a`   | `#EEF2F7`   | Page background               |
| `surface`   | `bg-surface`    | `#111111`   | `#F5F7FB`   | Card/panel backgrounds        |
| `raised`    | `bg-raised`     | `#161616`   | `#E4E9F2`   | Elevated surfaces, icon boxes |
| `overlay`   | `bg-overlay`    | `#161616`   | `#F5F7FB`   | Modals, popovers              |
| `dim`       | `bg-dim`        | `#1a1a1a`   | `#D0D8E8`   | Dividers, subtle backgrounds  |
| `dim-hover` | `bg-dim-hover`  | `#252525`   | `#B8C3D9`   | Hover state for dim           |
| `heading`   | `text-heading`  | `#e2e0da`   | `#0C1631`   | Headings, titles              |
| `body`      | `text-body`     | `#c0c0c0`   | `#2A3556`   | Body text                     |
| `subtle`    | `text-subtle`   | `#888888`   | `#5C6A8A`   | Secondary text, labels, muted |

Additional dark-mode-only tokens (not in `@theme`, use via inline style or direct class):

| Variable              | Value       | Usage                     |
|-----------------------|-------------|---------------------------|
| `--field-background`  | `#0f0f0f`   | Form input backgrounds    |
| `--border`            | `#1e1e1e`   | Default border color      |
| `--separator`         | `#1e1e1e`   | Divider lines             |
| `--glass-bg`          | `#141414`   | Glass panel background    |
| `--glass-border`      | `#1e1e1e`   | Glass panel border        |

### 2.2 Brand Orange Scale

Primary: `#ff6b2c`. Gradient endpoint: `#ff8533`. Shadow: `#cc5500`.

| Opacity | Value                          | CSS Variable          | Usage                           |
|---------|--------------------------------|-----------------------|---------------------------------|
| 4%      | `rgba(255, 107, 44, 0.04)`    | —                     | Subtle background tint          |
| 8%      | `rgba(255, 107, 44, 0.08)`    | `--orange-dim`        | Dim backgrounds, borders        |
| 15%     | `rgba(255, 107, 44, 0.15)`    | `--orange-glow`       | Glow effects                    |
| 20%     | `rgba(255, 107, 44, 0.2)`     | —                     | Active backgrounds              |
| 25%     | `rgba(255, 107, 44, 0.25)`    | `--orange-border-hover` | Hover border color           |
| 30%     | `rgba(255, 107, 44, 0.3)`     | —                     | Strong glow, button shadow      |
| 35%     | `rgba(255, 107, 44, 0.35)`    | —                     | Text selection background       |
| 50%     | `rgba(255, 107, 44, 0.5)`     | —                     | Focus ring                      |
| 100%    | `#ff6b2c`                      | `--accent`            | Solid buttons, active states    |

### 2.3 Status Colors

| State   | Color     | Tailwind           | Usage                     |
|---------|-----------|--------------------|---------------------------|
| Success | `#22c55e` | `text-green-500`   | Connected, active, online |
| Error   | `#ef4444` | `text-red-500`     | Errors, danger, delete    |
| Warning | `#f59e0b` | `text-yellow-500`  | Caution, pending          |

Status background pattern: `bg-{color}-500/10` for containers, `bg-{color}-500` for badges/dots.

### 2.4 Contrast Rules

- Heading text on dark surfaces: minimum `#e2e0da` on `#0a0a0a` (contrast ratio ~14:1).
- Body text: minimum `#c0c0c0` on `#111111` (~10:1).
- Subtle text: minimum `#888888` on `#161616` (~4.6:1, WCAG AA for large text).
- Orange accent `#ff6b2c` on dark backgrounds meets AA for large text only. Use white text on solid orange buttons.
- Selection: `rgba(255, 107, 44, 0.35)` background with `#fff` text.

---

## 3. Typography

### 3.1 Font Stack

| Token           | CSS Variable                | Family                                          | Usage                              |
|-----------------|-----------------------------|--------------------------------------------------|------------------------------------|
| Display/Body    | `--font-geist-sans`         | `'Geist', sans-serif`                            | Body text, paragraphs, UI defaults |
| Branded/Mono    | `--font-jetbrains-mono`     | `'JetBrains Mono', 'Fira Code', monospace`      | Headings, nav labels, badges, code |
| Code            | `--font-geist-mono`         | `'Geist Mono', monospace`                       | Code blocks                        |

**Fira Code** is the required fallback for the branded/mono stack. Every `<h1>`, `<h2>`, `<h3>`, label, badge text, sidebar item, nav chip, modal title, and empty-state title MUST declare the stack inline (JetBrains Mono is a Next.js font variable, not a Tailwind utility):

```tsx
style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
```

**Rule — headings without this style are a bug.** A missing inline fontFamily on a heading means the browser falls back to Geist Sans, breaking the branded feel. Review every heading you touch.

### 3.2 Type Scale

| Role     | Size               | Weight     | Line Height  | Usage                            |
|----------|--------------------|------------|--------------|----------------------------------|
| Caption  | `text-[10px]`–`text-[11px]` | 500–600 | tight    | Labels, sidebar section headers  |
| Small    | `text-xs` (12px)   | 400–500    | normal       | Field errors, metadata           |
| Body     | `text-sm` (14px)   | 400        | relaxed      | Default body text, descriptions  |
| Subtitle | `text-base` (16px) | 600        | normal       | Section headings                 |
| Title    | `text-lg`–`text-xl`| 700        | tight        | Page titles                      |
| Hero     | `text-3xl`–`text-5xl` | 700–800 | tight        | Landing page headings            |

### 3.3 Patterns in Use

```tsx
{/* Page title */}
<h1 className="text-heading text-xl font-bold" style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>
  Page Title
</h1>

{/* Sidebar section label */}
<span className="text-[11px] font-semibold tracking-wider uppercase text-subtle"
      style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>
  SECTION
</span>

{/* Header branded text */}
<span className="font-bold tracking-[2px] uppercase text-[13px]">PAINEL</span>
```

---

## 4. Spacing & Layout

### 4.1 Spacing Scale

Use Tailwind's 4px-based scale. The project's most common values:

| Tailwind | px  | Common use                    |
|----------|-----|-------------------------------|
| `1`      | 4   | Tight inline gaps             |
| `1.5`    | 6   | Icon-label gaps               |
| `2`      | 8   | Button padding, small gaps    |
| `2.5`    | 10  | Nav item gaps                 |
| `3`      | 12  | Card inner spacing, gaps      |
| `4`      | 16  | Section gaps, padding         |
| `5`      | 20  | Card padding, modal padding   |
| `6`      | 24  | Section spacing, grid gaps    |
| `8`      | 32  | Large section gaps            |
| `10`     | 40  | Page section separation       |
| `16`     | 64  | Empty state vertical padding  |

### 4.2 Layout Patterns

**Page container:**
```tsx
<div className="max-w-7xl mx-auto px-4 lg:px-8 py-6">
  {/* Content */}
</div>
```

**Responsive grid (cards):**
```tsx
<div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
  {/* Cards */}
</div>
```

**Form grid (two columns on desktop):**
```tsx
<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
  {/* Fields */}
</div>
```

**Dashboard layout:**
```tsx
<div className="min-h-screen flex flex-col lg:flex-row">
  <Sidebar />
  <main className="flex-1 overflow-auto">
    <Header />
    {children}
  </main>
</div>
```

### 4.3 Breakpoints

| Prefix | Min-width | Behavior                                    |
|--------|-----------|---------------------------------------------|
| `sm:`  | 640px     | 2-column grids, wider modals                |
| `md:`  | 768px     | Show desktop nav, hide hamburger            |
| `lg:`  | 1024px    | Sidebar becomes static, 3-col grids         |
| `xl:`  | 1280px    | Max-width content, wider grids              |

**Sidebar responsive pattern:**
```tsx
{/* Mobile: full-screen overlay drawer. Desktop: static sidebar. */}
className="fixed inset-y-0 left-0 z-50 transform -translate-x-full lg:translate-x-0 lg:static"
```

---

## 5. Elevation & Depth

### 5.1 Elevation Levels

| Level     | Pattern                                                                 | Usage                      |
|-----------|-------------------------------------------------------------------------|----------------------------|
| **Flat**  | No shadow, `bg-app`                                                     | Page background            |
| **Surface** | `bg-surface`, `border border-dim`                                     | Cards at rest              |
| **Raised** | Neumorphic outset shadow                                               | Buttons, icon containers   |
| **Glass** | `backdrop-filter: blur(12-40px)` + semi-transparent bg                  | Header, sidebar, panels    |
| **Overlay** | `bg-black/50 backdrop-blur-sm` + elevated card                        | Modals, drawers            |

### 5.2 Shadow Definitions

**Neumorphic button (default):**
```css
box-shadow:
  4px 4px 10px rgba(0, 0, 0, 0.5),
  -2px -2px 8px rgba(255, 255, 255, 0.04);
```

**Neumorphic button (hover/pressed):**
```css
box-shadow:
  2px 2px 6px rgba(0, 0, 0, 0.6),
  -1px -1px 4px rgba(255, 255, 255, 0.06);
```

**Sidebar active item (inset neumorphism):**
```css
box-shadow:
  inset 2px 2px 6px rgba(0, 0, 0, 0.5),
  inset -1px -1px 4px rgba(255, 255, 255, 0.03);
```

**Glass card (default):**
```css
box-shadow:
  inset 0 1px 0 rgba(255, 255, 255, 0.04),
  0 2px 6px rgba(0, 0, 0, 0.2);
```

**Glass card (hover):**
```css
box-shadow:
  inset 0 1px 0 rgba(255, 255, 255, 0.06),
  0 8px 20px rgba(0, 0, 0, 0.35);
```

**Orange glow (CTA buttons):**
```css
box-shadow: 0 0 24px rgba(255, 107, 44, 0.3);
```

### 5.3 Glassmorphism

Use the utility classes defined in `globals.css`:

```tsx
{/* Light glass — navigation surfaces */}
<div className="glass-panel border border-dim rounded-xl p-6">
  {/* backdrop-filter: blur(20px), semi-transparent bg */}
</div>

{/* Heavy glass — cards with depth */}
<div className="glass-card">
  {/* bg-[#141414], border #1e1e1e, inset highlight shadow */}
</div>
```

Blur values by context:
- `blur(12px)` — `--glass-blur`, default panels
- `blur(20px)` — header, landing navbar
- `blur(40px)` — sidebar

---

## 6. Component Patterns

### 6.1 Button

**Dashboard buttons MUST use the neumorphic CSS classes from `globals.css`. Using `<Button>` from `@heroui/react` in any file under `app/dashboard/**` or `components/**` (except `components/landing/` and `components/admin/`) is a bug.** HeroUI `Button` is reserved for landing pages and admin panel only.

The neumorphic look is the dashboard's identity — a flat orange button or a `bg-[#ff6b2c]` rectangle breaks the visual language even if the color is right. If you find yourself writing `<Button className="bg-[#ff6b2c]...">` inside a dashboard component, stop and switch to `<button className="btn-neu">`.

**CSS classes (defined in `globals.css`):**

| Class           | Appearance                               | Usage                        |
|-----------------|------------------------------------------|------------------------------|
| `btn-neu`       | Neumorphic outset shadow, `#D4835A` text | Primary action, submit, save |
| `btn-neu-ghost` | Transparent, subtle text, no shadow      | Cancel, secondary action     |
| `btn-neu-lg`    | Larger padding/font (14px, 10px radius)  | Add to `btn-neu` for hero CTAs |

**States:** default → hover (shadow reduces + color brightens) → active (`scale(0.97)`) → disabled (`opacity: 0.4`)

```tsx
{/* Primary — neumorphic submit */}
<button type="submit" className="btn-neu text-sm">
  Salvar Assistente
</button>

{/* Large CTA */}
<button className="btn-neu btn-neu-lg" onClick={handleCreate}>
  Criar Assistente
</button>

{/* Cancel / secondary */}
<button type="button" className="btn-neu-ghost text-sm" onClick={onCancel}>
  Cancelar
</button>

{/* Danger — neumorphic with red override */}
<button type="button" className="btn-neu text-sm !text-red-400 hover:!text-red-300" onClick={handleDelete}>
  Excluir
</button>

{/* Icon-only — neumorphic square */}
<button
  className="w-9 h-9 rounded-[10px] flex items-center justify-center bg-[#121212] transition-all duration-200 text-subtle hover:text-heading"
  style={{ boxShadow: '3px 3px 7px rgba(0,0,0,0.45), -1px -1px 5px rgba(255,255,255,0.03)' }}
>
  <Settings size={16} />
</button>

{/* Round neumorphic (meeting controls, floating actions) */}
<button
  className="w-11 h-11 rounded-full flex items-center justify-center bg-raised text-body hover:text-heading transition-all duration-200 active:scale-[0.97]"
  style={{ boxShadow: '4px 4px 10px rgba(0,0,0,0.5), -2px -2px 8px rgba(255,255,255,0.04)' }}
>
  <Mic size={18} />
</button>

{/* Destructive round (hang up, off states) */}
<button
  className="w-11 h-11 rounded-full flex items-center justify-center bg-red-500 text-white hover:bg-red-600 transition-all duration-200 active:scale-[0.97]"
  style={{ boxShadow: '4px 4px 10px rgba(0,0,0,0.5), -2px -2px 8px rgba(255,255,255,0.04)' }}
>
  <PhoneOff size={18} />
</button>
```

### 6.2 Card

**Anatomy:** Icon container (rounded-lg, bg-raised) + Title (JetBrains Mono) + Description + Footer (optional).

**States:** default → hover (border brightens, shadow deepens, subtle orange glow) → focus-visible

```tsx
<div className="glass-card rounded-xl p-5 transition-all duration-300 hover:shadow-lg">
  <div className="flex items-center gap-3 mb-3">
    <div className="w-9 h-9 rounded-lg bg-raised flex items-center justify-center">
      <Bot size={18} className="text-[#ff6b2c]" />
    </div>
    <h3 className="text-heading text-sm font-semibold"
        style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>
      Card Title
    </h3>
  </div>
  <p className="text-body text-sm leading-relaxed">Description text here.</p>
</div>
```

### 6.3 Input / TextField

**Anatomy:** Label (JetBrains Mono, subtle, xs) + Input field + FieldError.

**States:** default → focus (orange border + ring) → error (red text below) → disabled (`opacity-40`)

```tsx
<TextField>
  <Label className="text-subtle text-xs font-medium mb-1.5 block"
         style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>
    Label
  </Label>
  <Input
    className="bg-raised border border-dim rounded-[10px] px-3 py-2.5 text-body text-sm
               placeholder:text-subtle/50
               focus:border-[#ff6b2c]/50 focus:ring-1 focus:ring-[#ff6b2c]/20
               transition-all duration-200 outline-none w-full"
    placeholder="Placeholder..."
    {...field}
  />
  <FieldError className="text-red-400 text-xs mt-1" />
</TextField>
```

### 6.4 Select

**Anatomy:** Uses HeroUI compound components with dot-notation.

```tsx
<Select>
  <Select.Trigger className="bg-raised border border-dim rounded-[10px] px-3 py-2.5 text-sm text-body w-full">
    <Select.Value placeholder="Choose..." />
    <Select.Indicator />
  </Select.Trigger>
  <Select.Popover className="bg-overlay border border-dim rounded-xl shadow-xl">
    <ListBox>
      <ListBox.Item id="opt1">Option 1</ListBox.Item>
    </ListBox>
  </Select.Popover>
</Select>
```

### 6.5 Modal

**Anatomy:** Backdrop (blur + dark overlay) → Container → Dialog (rounded-xl, bg-overlay, shadow) → Header + Body + Footer.

**States:** entering (scale 0.92→1, opacity 0→1) → open → exiting (reverse)

```tsx
<Modal>
  <Modal.Backdrop className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
  <Modal.Container className="fixed inset-0 z-50 flex items-center justify-center">
    <Modal.Dialog className="bg-overlay border border-dim rounded-xl shadow-2xl sm:max-w-[400px] w-full mx-4 p-6">
      <Modal.Header className="flex items-center justify-between mb-4">
        <Modal.Heading className="text-heading text-[15px] font-bold"
                       style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>
          Modal Title
        </Modal.Heading>
        <Modal.CloseTrigger className="text-subtle hover:text-heading transition-colors" />
      </Modal.Header>
      <Modal.Body>{/* Content */}</Modal.Body>
      <Modal.Footer className="flex justify-end gap-3 mt-6">
        <Button variant="ghost">Cancel</Button>
        <Button className="bg-[#ff6b2c]">Confirm</Button>
      </Modal.Footer>
    </Modal.Dialog>
  </Modal.Container>
</Modal>
```

### 6.6 Table

No dedicated table component exists yet. Data lists use card grids or flex rows with consistent spacing:

```tsx
{/* Row-based data list pattern */}
<div className="flex items-center justify-between px-4 py-3 border-b border-dim hover:bg-dim/50 transition-colors">
  <div className="flex items-center gap-3">
    <div className="w-8 h-8 rounded-lg bg-raised flex items-center justify-center">
      <Icon size={16} className="text-subtle" />
    </div>
    <div>
      <p className="text-heading text-sm font-medium">Item name</p>
      <p className="text-subtle text-xs">Metadata</p>
    </div>
  </div>
  <span className="text-subtle text-xs">Action</span>
</div>
```

### 6.7 Badge

```tsx
{/* Status badge */}
<span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-[#ff6b2c]/15 text-[#ff6b2c] border border-[#ff6b2c]/30">
  Active
</span>

{/* Notification dot */}
<span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-500 rounded-full" />

{/* Count badge */}
<span className="bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
  3
</span>
```

### 6.8 Nav Item (Sidebar)

**States:** default → hover (bg shift) → active (inset neumorphic shadow + orange text/icon)

```tsx
{/* Sidebar nav item */}
<a className={`w-full flex items-center gap-2.5 px-4 h-11 rounded-lg transition-all duration-200
    ${isActive
      ? 'sidebar-item-active text-[#ff6b2c]'
      : 'text-subtle hover:text-heading hover:bg-dim/50'
    }`}
   style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
>
  <Icon size={16} />
  <span className="text-[13px] font-medium">{label}</span>
</a>
```

The `sidebar-item-active` class applies the inset neumorphic shadow from `globals.css`.

### 6.9 Empty State

```tsx
<div className="flex flex-col items-center justify-center py-16 text-center">
  <div className="w-14 h-14 rounded-xl bg-raised flex items-center justify-center mb-4">
    <Bot size={24} className="text-subtle" />
  </div>
  <h3 className="text-heading text-base font-semibold mb-1"
      style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>
    No items yet
  </h3>
  <p className="text-subtle text-sm max-w-xs">Get started by creating your first item.</p>
  <Button className="mt-4 bg-[#ff6b2c] text-white text-sm rounded-[10px] px-4 py-2">
    <Plus size={16} /> Create
  </Button>
</div>
```

### 6.10 Skeleton / Loading

The project uses `<Spinner size="sm" />` from HeroUI and animated typing dots. No dedicated skeleton components exist yet.

```tsx
{/* Spinner (centered) */}
<div className="flex items-center justify-center h-full">
  <Spinner size="sm" />
</div>

{/* Typing indicator dots */}
<div className="flex gap-1 items-center p-1">
  {[0, 1, 2].map((i) => (
    <div key={i}
         className="w-1.5 h-1.5 rounded-full bg-subtle"
         style={{ animation: `typing-dot 1.4s infinite ${i * 0.2}s` }}
    />
  ))}
</div>

{/* Loading text */}
<p className="text-sm text-subtle">Carregando...</p>
```

### 6.11 Error State

```tsx
{/* Error modal header */}
<div className="flex items-center gap-3">
  <div className="flex items-center justify-center w-10 h-10 rounded-full bg-red-500/10">
    <AlertTriangle className="w-5 h-5 text-red-500" />
  </div>
  <h3 className="text-lg font-semibold text-heading">{title}</h3>
</div>

{/* Inline error toast */}
<div className="p-4 rounded-xl glass-card" style={{ border: '1px solid rgba(239,68,68,0.3)' }}>
  <p className="text-xs text-red-400 font-medium mb-1">Error title</p>
  <p className="text-xs text-subtle">Error details.</p>
</div>

{/* Field validation error */}
<FieldError className="text-red-400 text-xs mt-1" />
```

---

## 7. Animation & Motion

### 7.1 Entrance Animations

| Class                  | Effect                    | Duration | Easing     |
|------------------------|---------------------------|----------|------------|
| `animate-fade-in-up`   | Fade + slide up 24px      | 0.6s     | ease-out   |
| Inline `fadeSlideUp`    | Fade + slide up 16px      | 0.4s     | ease       |
| Inline `fadeSlideIn`    | Fade + slide up 12px      | 0.3s     | ease       |
| `baisync-panel-in`      | Scale 0.92→1 + fade       | 0.3s     | cubic-bezier(0.16,1,0.3,1) |
| `baisync-msg-in`        | Slide up 8px + fade       | 0.2s     | ease-out   |

### 7.2 Looping Animations

| Class                    | Effect                        | Duration |
|--------------------------|-------------------------------|----------|
| `animate-float`          | Y-axis float ±10px           | 6s       |
| `float-slow`             | Y-axis float ±20px           | 8s       |
| `float-medium`           | Y-axis float ±12px           | 6s       |
| `animate-pulse-glow`     | Orange box-shadow pulse       | 3s       |
| `animate-gradient-shift` | Background position shift     | 8s       |
| `animate-pulse-dot`      | Opacity pulse                 | 2s       |
| `animate-blink`          | Cursor blink                  | 1s       |

### 7.3 Micro-interactions

```tsx
{/* Hover border glow */}
className="transition-all duration-300 hover:border-[#ff6b2c]/30 hover:shadow-[0_0_20px_rgba(255,107,0,0.08)]"

{/* Background shift */}
className="transition-colors duration-200 hover:bg-dim"

{/* Scale (avoid on cards with neumorphic shadows — conflicts) */}
className="transition-transform duration-200 hover:scale-[1.02]"
```

### 7.4 Transition Defaults

| Context            | Duration       | Easing                                  |
|--------------------|----------------|-----------------------------------------|
| Color/opacity      | `duration-200` | default (ease)                          |
| Layout/shadow      | `duration-300` | default                                 |
| Page transitions   | `duration-500` | default                                 |
| Bounce entrance    | custom         | `cubic-bezier(0.34, 1.56, 0.64, 1)`    |
| Smooth entrance    | custom         | `cubic-bezier(0.16, 1, 0.3, 1)`        |

Always specify the transition property: `transition-colors`, `transition-all`, `transition-transform`.

### 7.5 Staggered Entrance

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

---

## 8. Accessibility

### 8.1 Focus Management

- Default focus style: `focus:border-[#ff6b2c]/50 focus:ring-1 focus:ring-[#ff6b2c]/20`
- Remove browser default: `outline-none` (but always replace with visible focus indicator)
- Interactive non-button elements: add `tabIndex={0}` and `role="button"`

```tsx
<div role="button" tabIndex={0} onPress={handlePress}
     className="focus:outline-none focus:ring-2 focus:ring-[#ff6b2c]/40 rounded-lg">
```

### 8.2 ARIA Patterns

- Expandable sections: `aria-expanded={isOpen}`
- Icon-only buttons: always include `aria-label`
- Dropdown triggers: HeroUI handles `aria-haspopup` and `aria-expanded` automatically
- Modals: HeroUI Modal manages focus trap and `role="dialog"` automatically

```tsx
<button aria-label="Notifications" className="relative">
  <Bell size={18} />
  {unread > 0 && <span className="sr-only">{unread} unread</span>}
</button>
```

### 8.3 Touch Targets

Minimum interactive size: `w-8 h-8` (32px). Preferred: `w-9 h-9` (36px) or `h-11` (44px for nav items).

### 8.4 Reduced Motion

Not yet implemented globally. When adding animations, wrap non-essential ones:

```tsx
className="motion-safe:animate-fade-in-up"
```

---

## 9. Icons

- **Library**: `lucide-react` — always use this, never other icon libraries
- **Sizes**: `size={16}` for inline/buttons, `size={18}` for nav items, `size={20}` for standalone, `size={24}` for empty states/hero
- **Color**: Inherit from parent via `currentColor`, or explicit `className="text-[#ff6b2c]"` for accent

```tsx
import { Bot, Settings, Plus, AlertTriangle } from 'lucide-react'
<Bot size={16} />
```

---

## 10. Scrollbar

Custom scrollbar is defined globally in `globals.css`:

```css
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #1e1e1e; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #282828; }
```

No action needed per-component — this applies automatically.

---

## 11. HeroUI v3 — Mandatory Rules

1. **Read** `frontend/.agents/skills/heroui-react/SKILL.md` before using any HeroUI component
2. Use **compound components** with dot-notation: `Modal.Backdrop`, `Modal.Container`, `Modal.Dialog`, `Select.Trigger`, etc.
3. Use `onPress` instead of `onClick` on all HeroUI interactive components
4. Do **NOT** use `HeroUIProvider` — v3 does not need it
5. Do **NOT** use `framer-motion` for new code — v3 uses CSS animations natively
6. Forms: always use React Hook Form + Zod for validation

---

## 12. Do / Don't

| Do | Don't |
|----|-------|
| Use `bg-surface`, `text-heading` semantic tokens | Use hardcoded `bg-[#111111]` or `text-[#e2e0da]` |
| Apply neumorphic shadows via the established patterns | Use Tailwind `shadow-md` or flat Material shadows |
| Use `#ff6b2c` (the actual CSS variable value) as accent | Use `#FF6B00` (the old/documented value that isn't in the CSS) |
| Add `transition-colors duration-200` on every interactive element | Leave hover states without transitions |
| Use JetBrains Mono for headings, labels, nav text | Use JetBrains Mono for body paragraphs |
| Apply `focus:ring-[#ff6b2c]/20` visible focus indicators | Use `outline-none` without a replacement focus style |
| Use `<Spinner size="sm" />` for loading states | Show nothing while content loads |
| Stagger entrance animations with `animationDelay` | Animate everything at once (jarring) |
| Use `lucide-react` icons exclusively | Import from `react-icons`, `heroicons`, or inline SVGs |
| Apply `border border-dim` on cards and panels | Use borderless floating cards (no visual boundary) |

---

## 13. Checklist — Before Every PR

- [ ] **Dashboard buttons use `btn-neu` / `btn-neu-ghost` / neumorphic round — NOT `<Button>` from `@heroui/react`**
- [ ] **Every `<h1>/<h2>/<h3>` and heading-role element has `style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}`**
- [ ] Semantic color tokens used everywhere (no raw hex for surfaces/text)
- [ ] JetBrains Mono applied to headings, labels, navigation, badges
- [ ] Smooth transitions on ALL interactive elements (minimum `duration-200`)
- [ ] Border radius matches tokens: `rounded-[10px]` buttons/inputs, `rounded-xl` cards/panels, `rounded-md` badges
- [ ] Proper spacing rhythm using Tailwind scale (no arbitrary pixel values unless matching existing patterns)
- [ ] Hover states on every clickable element
- [ ] Focus states with orange accent ring on every focusable element
- [ ] `aria-label` on icon-only buttons
- [ ] Loading state handled (Spinner or placeholder)
- [ ] Empty state handled (icon + message + optional CTA)
- [ ] Error state handled (red accent, descriptive message)
- [ ] Entrance animation on dynamically loaded content (`animate-fade-in-up`)
- [ ] Staggered delays on lists/grids (`animationDelay: i * 80ms`)
- [ ] Icons from `lucide-react` only, consistent size per context
- [ ] Responsive tested: mobile (default), `sm:`, `md:`, `lg:` breakpoints
- [ ] Dark mode is default — verify light mode renders correctly if supported
- [ ] No `framer-motion` imports — use CSS animations only
- [ ] `onPress` on HeroUI components, never `onClick`
