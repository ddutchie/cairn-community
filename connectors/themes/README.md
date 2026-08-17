# Chat Themes

Chat themes are community-contributed **looks for the Cairn chat surface** —
background, bubbles, and the chat font — compiled into a separate
[`themes.json`](../../themes.json) manifest so new themes ship to the apps
**without an app update**. Cairn fetches this manifest at runtime
(ETag-cached, refreshed from the AI-settings **Tuning** tab).

A theme is **pure JSON**. It never executes code — the apps render it
data-driven (CSS variables on desktop, theme fields + `LinearGradient` on
mobile), so it's safe to hot-load from this catalog. Restricting fonts to the
three system stacks and backgrounds to solid/gradient/scanline is what makes
that safe.

> Themes live in their own folder and compile into their own manifest, like
> providers/automations/personalities. `themes.json` is a **compiled artifact** —
> never hand-edit it; run `node scripts/build-manifest.mjs`.

## Contributing a theme

Create `connectors/themes/<id>/connector.json` where `<id>` is a stable
kebab-case slug. Example:

```json
{
  "kind": "theme",
  "author": "your-handle",
  "version": "1.0.0",
  "category": "Appearance",
  "tags": ["chat", "theme", "ocean", "teal"],
  "blurb": "Deep teal→blue gradient with frosted glass bubbles.",
  "brandColor": "#2dd4bf",
  "definition": {
    "name": "Ocean",
    "description": "Teal→blue gradient with frosted glass bubbles.",
    "font": "sans",
    "fontWeight": "regular",
    "tracking": 0,
    "lineHeight": 1,
    "bgType": "gradient",
    "pattern": "none",
    "bubbleStyle": "glass",
    "radius": "md",
    "shadow": "subtle",
    "dark": {
      "bg": "#071318",
      "stops": ["#071318", "#0a1f33"],
      "userBubble": "#2dd4bf",
      "userBubbleFg": "#04231f",
      "aiBubble": "rgba(20,52,66,0.75)",
      "aiText": "#9be8dc"
    },
    "light": {
      "bg": "#eefaf9",
      "stops": ["#eefaf9", "#e6f1fc"],
      "userBubble": "#0a7568",
      "userBubbleFg": "#ffffff",
      "aiBubble": "rgba(255,255,255,0.85)",
      "aiText": "#0a3d36"
    }
  }
}
```

## How the colors are used

Cairn renders each theme's palette onto the chat surface. The apps consume
these exact fields — there is **no mixing or blending with the app's accent
colour** (the user's accent choice stays independent of the theme).

| Field | What it paints |
|-------|----------------|
| `dark` / `light` | One palette per OS colour scheme. Both are **required**. |
| `dark.bg` / `light.bg` | The chat message-area background base colour. For `bgType: "gradient"` the `stops` array replaces it; for `pattern` it's the overlay's base colour. |
| `dark.stops` / `light.stops` | Background stops: `[color]` for solid/pattern themes, or **2+** gradient stops for gradients. `stops[0]` must equal `bg`. |
| `userBubble` | The user-message bubble fill. |
| `userBubbleFg` | Text colour **on** the user bubble (used for the message text and any markdown inside it — headings, links, inline code). |
| `aiBubble` | The assistant-message bubble fill. May be an `rgba(...)` translucent value for `glass` themes (the app applies the blur/frost). |
| `aiText` | Assistant-message text colour (phosphor green for terminal, etc.). Required — every theme picks its AI text colour explicitly. |

### Field rules

- **`font`** — `"sans" | "serif" | "mono"`. This is the chat text font, applied
  to the chat surface only (independent of the app's note-font setting). It
  must be one of these three **system stacks** — bundling a custom webfont is
  not supported, because the app's print/PDF path and mobile rendering need a
  font that's always available without shipping a file.
- **`fontWeight`** — `"regular" | "medium"` (400/500). Chat-text weight.
- **`tracking`** — letter-spacing in px (0 = default tracking). A small number
  (0–0.5) for a slightly airier editorial feel.
- **`lineHeight`** — line-height multiplier applied to chat text (1 = platform
  default). Range 0.8–3.
- **`bgType`** — `"solid" | "gradient" | "pattern"`. `gradient` needs 2+ stops
  in **each** mode's palette; `pattern` renders a named pattern over the base
  colour.
- **`pattern`** — `"none" | "scanlines" | "dots" | "grid" | "crosshatch" |
  "diagonal" | "noise"`. Only rendered when `bgType === "pattern"`; set `"none"`
  for solid/gradient themes.
- **`bubbleStyle`** — `"filled" | "glass" | "outlined"`. `glass` bubbles get a
  translucent fill (your `aiBubble`/`userBubble` can be `rgba(...)`) plus a
  blur; `outlined` uses transparent fills with tinted borders.
- **`radius`** — `"sm" | "md" | "pill"` bubble corner radius.
- **`shadow`** — `"none" | "subtle" | "strong"` bubble shadow intensity.
- `userBubble` + `userBubbleFg` must pass **WCAG AA (≥4.5:1)** contrast in both
  `dark` and `light`; so must `aiBubble` + `aiText` (hex pairs). The build
  script enforces both — a theme that fails won't compile.

> **Nothing is optional.** The theme shape shipped pre-release, so every field
> above is **required** — there are no defaults to lean on. A theme that omits a
> knob is rejected by validation.

## Built-in themes (do not duplicate these)

The app ships five **built-in** themes — always available, zero network, and
**NOT** part of this manifest. When you create a community theme, avoid
re-implementing or closely imitating them; the picker shows community themes
under a separate "Community" group, so a near-duplicate just adds noise.

| id | Name | Font | Weight | Background | Bubbles | Vibe |
|----|------|------|--------|-----------|---------|------|
| `default` | Default | sans | regular | solid | filled | The classic Cairn look (byte-matches the app's default styling) |
| `paper` | Paper | serif | regular | warm cream solid | filled (subtle shadow) | Editorial reading |
| `terminal` | Terminal | mono | regular | charcoal-green scanlines | outlined | Developer / terminal |
| `midnight` | Midnight | sans | regular | indigo→violet gradient | glass (subtle shadow) | Premium dark |
| `aurora` | Aurora | sans | medium | pink→purple gradient | filled (strong shadow) | Energetic, vivid |

> **Why they're built-in and not here:** they must render before the catalog is
> ever fetched (first launch, offline), they define the app's fallback look, and
> they're part of the app's test suite. Community themes extend this set — they
> don't replace it.

A good community theme finds a **new corner** of the design space: a different
font pairing, background treatment, palette, or mood that none of the five
built-ins (or existing catalog themes) already cover.

## Validation

`node scripts/validate.mjs` checks every theme: required fields, valid
`font`/`bgType`/`bubbleStyle`, `gradient` presence when required, unique names,
and the WCAG AA contrast gate. It runs in CI and gates merges.
