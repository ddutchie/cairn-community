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
    "bgType": "gradient",
    "bubbleStyle": "glass",
    "dark": {
      "bg": "#071318",
      "gradient": ["#071318", "#0a1f33"],
      "userBubble": "#2dd4bf",
      "userBubbleFg": "#04231f",
      "aiBubble": "rgba(20,52,66,0.75)"
    },
    "light": {
      "bg": "#eefaf9",
      "gradient": ["#eefaf9", "#e6f1fc"],
      "userBubble": "#0a7568",
      "userBubbleFg": "#ffffff",
      "aiBubble": "rgba(255,255,255,0.85)"
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
| `dark.bg` / `light.bg` | The chat message-area background. For `bgType: "gradient"` the two `gradient` stops replace it; for `pattern` it's the scanline base colour. |
| `dark.gradient` / `light.gradient` | `[from, to]` gradient stops. Required when `bgType` is `"gradient"`; ignored otherwise. |
| `userBubble` | The user-message bubble fill. |
| `userBubbleFg` | Text colour **on** the user bubble (used for the message text and any markdown inside it — headings, links, inline code). |
| `aiBubble` | The assistant-message bubble fill. May be an `rgba(...)` translucent value for `glass` themes (the app applies the blur/frost). |
| `aiText` | Optional assistant-message text colour. Defaults to the app's muted text token when omitted. Useful for `outlined`/terminal looks (e.g. phosphor green). |

### Field rules

- **`font`** — `"sans" | "serif" | "mono"`. This is the chat text font, applied
  to the chat surface only (independent of the app's note-font setting). It
  must be one of these three **system stacks** — bundling a custom webfont is
  not supported, because the app's print/PDF path and mobile rendering need a
  font that's always available without shipping a file.
- **`bgType`** — `"solid" | "gradient" | "pattern"`. `pattern` is currently
  always a scanline overlay on `bg`; `gradient` needs both stops in **each**
  mode's palette.
- **`bubbleStyle`** — `"filled" | "glass" | "outlined"`. `glass` bubbles get a
  translucent fill (your `aiBubble`/`userBubble` can be `rgba(...)`) plus a
  blur; `outlined` uses transparent fills with tinted borders.
- `userBubble` + `userBubbleFg` must pass **WCAG AA (≥4.5:1)** contrast in both
  `dark` and `light`. The build script enforces this for hex pairs — a theme
  that fails won't compile.

## Built-in themes (do not duplicate these)

The app ships five **built-in** themes — always available, zero network, and
**NOT** part of this manifest. When you create a community theme, avoid
re-implementing or closely imitating them; the picker shows community themes
under a separate "Community" group, so a near-duplicate just adds noise.

| id | Name | Font | Background | Bubbles | Vibe |
|----|------|------|-----------|---------|------|
| `default` | Default | sans | solid | filled | The classic Cairn look (byte-matches the app's default styling) |
| `paper` | Paper | serif | warm cream solid | filled | Editorial reading |
| `terminal` | Terminal | mono | charcoal-green scanlines | outlined | Developer / terminal |
| `midnight` | Midnight | sans | indigo→violet gradient | glass | Premium dark |
| `aurora` | Aurora | sans | pink→purple gradient | filled | Energetic, vivid |

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
