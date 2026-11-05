# Design system — Life Tracker (v2: warmer, deeper, with a living centerpiece)

Direction: premium editorial. Calm, dense-but-quiet, like a well-made journal crossed with a fine instrument panel.
NOT allowed: UI kits (MUI, shadcn defaults, Chakra), Tailwind default look, purple/blue gradients, glassmorphism,
emoji as icons, rounded-2xl card grids with drop shadows, centered hero blobs, generic "dashboard" widgets.

## Principles
1. Typography carries the design. Large serif display numerals/headings, small caps labels, tabular figures for data.
2. Hairline borders (1px, low contrast) and spacing create structure — not shadows, not filled boxes.
3. One accent per stat (Body, Mind, Skill, Discipline), used sparingly: a thin bar, a dot, a number.
4. Asymmetric editorial layouts: a wide left column of content, a narrow right rail on desktop. Single column on phone.
5. Motion is subtle: 150–250ms ease-out fades and bar fills. Respect prefers-reduced-motion.
6. Everything usable one-handed on a phone: bottom tab bar on mobile, left rail on desktop.

## Type
- Display: "Instrument Serif" (Google Fonts) — headings, big numerals, level numbers.
- UI/body: "Geist" (Google Fonts), fallback system-ui.
- Mono/data: "Geist Mono", with `font-variant-numeric: tabular-nums`.
- Scale (rem): 0.72 label (uppercase, 0.08em tracking) · 0.875 secondary · 1 body · 1.25 · 1.75 · 2.75 · 4.5 display.

## Color tokens (see src/styles/tokens.css — the source of truth)
Dark (default): bg #0b0f0d, surface #101613, raised #151c18, line rgba(236,230,214,.09), text #ece6d6, muted #8f9a91, faint #5d675f.
Light: bg #f4f0e6, surface #efeadd, raised #e9e3d3, line rgba(20,28,22,.12), text #151c16, muted #5c665d.
Accent core (primary actions, focus): moss #8fb996 (dark) / #3f6b4b (light).
Stat accents (muted, desaturated): Body #c98f6b clay · Mind #8aa6b8 mist · Skill #c9b26b ochre · Discipline #a98fb8 heather.
Danger (XP loss/missed): #c0766a. Success uses the moss accent, never bright green.

## Spacing / shape
- Base unit 4px. Layout gutters 16px mobile, 32px desktop. Max content width 1120px.
- Radius: 6px controls, 10px sheets/modals. No pill-everything.
- Elevation: none by default; overlays use a 1px line + subtle scrim.

## Components (hand-built, in src/components/ui)
Button (solid/ghost/text), Checkbox-ring (circular progress check), Bar (hairline progress), Stat (label + big numeral),
SectionHeader (small-caps label + hairline), Sheet (bottom sheet mobile / side panel desktop), Tabs, Toggle, Field.
Icons: hand-drawn inline SVG set at 1.5px stroke, in src/components/icons.tsx. No icon libraries, no emoji.

## Signature elements (give it identity)
- Level ring: a thin 1.5px circular arc around a serif numeral on the Character screen.
- "Day line": Today's timeline is a vertical hairline with time ticks; blocks hang off it like annotations.
- Heatmap uses 5 tonal steps of the stat accent, square cells with 2px radius and 3px gaps.


## v2 direction (supersedes conflicting rules above)
The first pass was too flat. v2 adds atmosphere, depth and a signature illustration.
- Fonts: Fraunces (soft, warm display serif; use italic with SOFT/WONK for personality) + Figtree (UI). Instrument Serif and Geist are retired.
- Atmosphere: forest-night gradient with moss and amber glows plus film grain (set in tokens.css on body).
- Depth: use the `.card` class (lit gradient surface, 1px edge, soft long shadow) for primary modules. Tonal layering beats outlines. Radius: 18px cards, 10px controls, 20px sheets.
- Color: moss `--accent` for action, amber `--accent-2` for XP, rewards and warmth. Stat colors tint rings, bars and leaves.
- Glow: progress bars, checked rings and key numbers carry a faint glow of their own color.
- Signature: <Sapling /> (src/components/Sapling.tsx) is a tree that grows with the character; the four branches are the four stats. Show it on Today and Character.
- Still forbidden: UI kits, emoji, stock blue/purple gradients, glassmorphism everywhere (a blur on the mobile tab bar and scrims only), centered hero blobs, generic dashboard widgets.
- Layout: asymmetric, generous whitespace, big serif numerals as focal points, one hero module per screen.
