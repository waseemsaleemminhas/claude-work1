# Ironclad Tech — brand assets

Vector rebuild of the Ironclad Tech logo, drawn from the 400×400 PNG supplied
on 6 October 2026. The PNG was the only source: there is no AI/EPS/layered
original, and 400px is its ceiling.

**Nothing here is on the live site yet.** It is waiting on a decision between
variant A and variant B — see "Open questions" at the bottom.

## Why this exists

`getironcladtech.com` does not currently show the Ironclad logo. The header
(`<a class="brand">`) and every favicon size render a generic shield-with-a-
person icon that was dropped in to ship the site. The supplied artwork appears
nowhere.

## Files

| File | What it is | Use |
|---|---|---|
| `ironclad-mark.svg` | Variant A — chrome rim, dark field, 5-stop gold | Print, hero, video, anything over ~120px |
| `ironclad-mark-flat.svg` | Variant B — open shield in `#D4AF37`, transparent field | Site header, UI, anything 32–120px |
| `ironclad-mark-mono.svg` | One colour, inherits `currentColor` | Invoices, fax, embroidery, engraving, watermarks |
| `ironclad-favicon.svg` | Small-size cut: solid shield, letters knocked out | 16/32px favicon, app icon, PWA maskable |
| `intro.html` | The 2.4s animated intro, self-contained | Site hero load, or screen-record for video |

All four share one geometry, so they stay in register with each other:

- Shield: `M10 14 H110 A4 4 0 0 1 114 18 V66 C114 100 94 124 60 136 C26 124 6 100 6 66 V18 A4 4 0 0 1 10 14 Z`
- `I`: `M27 34 H53 V46 H45 V84 H51 V95 H29 V84 H35 V46 H27 Z`
- `T`: `M57 34 H93 V46 H81 V104 H69 V46 H57 Z`

`ironclad-favicon.svg` deliberately departs: strokes are ~35% heavier and the
gap between `I` and `T` is 6 units instead of 4, because the shared geometry is
illegible below about 24px.

### The gap between I and T is load-bearing

The supplied artwork runs the `I`'s top serif and the `T`'s crossbar together
into one continuous horizontal bar. Traced literally, that reads as **π**, not
**IT** — it was the first thing the rebuild got wrong. The 4-unit gap is what
makes it read as two letters. If fidelity to the original matters more than
legibility here, that is a decision to make deliberately, not by default.

## The wordmark is live text, not paths

"IRONCLAD TECH" is set in **Space Grotesk 700**, which `site.css` already
loads. Keeping it as text rather than outlines means no extra font download,
selectable and searchable markup, no path bloat, and no font-embedding licence
question. The site header already does this; only the mark beside it changes.

Tagline: **IBM Plex Mono 500**, uppercase, `0.165em` tracking, `#C9B37E`
(6.1:1 on navy). It is suppressed below 140px lock-up width — in the supplied
artwork it is unreadable at any size the logo actually ships at.

## Colour

Sampled from the PNG, against what `site.css` already uses:

| | Logo PNG | site.css |
|---|---|---|
| Gold | `#CDAD5A` (mid), `#8E7130`–`#DED29E` ramp | `#D4AF37`, lift `#F2D778` |
| Ground | `#121110` warm black, baked in | `#07162A` cool navy |

These are not the same gold, and the logo's baked-in black is not the site's
navy. That is why pasting the PNG into the header looks wrong even though the
file is correct. Variant B is drawn in `#D4AF37` with a transparent field,
which resolves both.

## Intro timing sheet

Open `intro.html` and press Replay, or call `window.playIntro()` from a capture
script. Honours `prefers-reduced-motion` by jumping straight to the finished
mark.

| Start | Duration | Element | Move |
|---|---|---|---|
| 0.00s | 0.72s | shield outline | stroke draws, `pathLength` normalised to 1000 |
| 0.50s | 0.50s | gold shield | floods up, `clip-path: inset(100% 0 0 0)` → `inset(0)` |
| 0.92s | 0.42s | `IT` monogram | stamps down from `scale(1.55)`, overshoot easing |
| 1.20s | 0.85s | specular sweep | skewed highlight crosses, clipped to the shield |
| 1.30s | 0.62s | IRONCLAD | tracking `0.42em` → `0.015em` |
| 1.62s | 0.50s | TECH + rules | fade up |
| 1.86s | 0.50s | tagline | fade up |

Total 2.36s. For an alpha export set `--stage: transparent` on `:root` and
record with an alpha-capable codec (WebM/VP9 or ProRes 4444).

## Still missing

Not yet produced, pending the A/B decision:

- PNG exports at 1×/2×/3×
- `favicon.ico`, `apple-touch-icon.png`, 192/512 PWA icons (the current ones
  are the placeholder icon)
- 1200×630 OG share image (`/images/og-image.jpg` is currently a photo)
- Horizontal and stacked lock-ups as standalone files
- The rendered WebM intro

## Open questions

1. **A or B for the website?** Recommendation: B everywhere on the site, A kept
   for print, video and anything above 120px. A normal two-cut system.
2. **Is the I/T gap acceptable?** See above — it departs from the original.
3. **Push to the site, or hand over files?**
4. **Who draws the video?** The WebM export can come from `intro.html`. Real
   metal shading and depth is After Effects work; the timing sheet above is the
   spec for whoever does it.
