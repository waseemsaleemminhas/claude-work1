# Ironclad Tech — brand assets

Vector rebuild of the Ironclad Tech logo, drawn from the 400×400 PNG supplied
on 6 October 2026. The PNG was the only source: there is no AI/EPS/layered
original, and 400px is its ceiling.

**Variant B is now on the website**, on branch `claude/kind-wozniak-tzxz0m` of
`waseemsaleemminhas/ironclad-tech-website` — not yet merged to `main`.

## Why this exists

`getironcladtech.com` did not show the Ironclad logo at all. The header
(`<a class="brand">`), the footer, the page loader and every favicon size
rendered a generic shield-with-a-person icon that was dropped in to ship the
site. `images/logo/*.png` and `images/brand/*.svg` were the same placeholder,
and the share image embedded it too.

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
| 0.00s | 0.56s | shield outline | stroke draws, `pathLength` normalised to 1000 |
| 0.30s | 0.50s | halo | fades in behind the mark |
| 0.39s | 0.40s | gold shield | floods up, `clip-path: inset(100% 0 0 0)` → `inset(0)` |
| 0.39s | 0.62s | gold shield | molten glow peaks at 45%, settles after |
| 0.72s | 0.36s | `IT` monogram | stamps down from `scale(1.55)`, overshoot easing |
| 0.72s | 0.42s | halo | spikes to 1.5× on the same cue, so the stamp lands |
| 0.94s | 0.70s | specular sweep | skewed highlight crosses, clipped to the shield |
| 1.02s | 0.50s | IRONCLAD | tracking `0.42em` → `0.015em` |
| 1.28s | 0.40s | TECH + rules | fade up |
| 1.46s | 0.40s | tagline | fade up |

Total 1.86s. For an alpha export set `--stage: transparent` on `:root` and
record with an alpha-capable codec (WebM/VP9 or ProRes 4444).

## Rendered video

`video/` holds the intro rendered from `intro.html` at 1920×1080, 30fps, 2.5s
(1.9s of motion plus a 0.6s hold on the finished mark):

| File | Codec | Use |
|---|---|---|
| `ironclad-intro-alpha.webm` | VP9, `yuva420p` | Web, and most NLEs |
| `ironclad-intro-alpha.mov` | ProRes 4444, 16-bit alpha | After Effects, Premiere, Resolve |
| `ironclad-intro-navy.mp4` | H.264 on `#07162A` | Anything that cannot take alpha |

Frames are produced by freezing the CSS timeline: each animation keeps its
easing and duration, its delay is shifted by −t, and `animation-play-state`
is paused, so the browser renders exactly the state the live animation holds
at time t. Re-render with `scratchpad/frames.py` + `render_video.sh`.

These timings are the same ones `assets/site.css` uses for the site's intro
loader, so the live loader, `intro.html` and the video cannot drift apart.
Change one, change all three.

The ProRes file is 21MB for 2.5s — larger than the earlier, longer cut,
because the molten glow adds per-frame detail that ProRes 4444 does not
compress away.

These are flat-cut renders. Real metal shading and depth is After Effects
work — the timing sheet above is the spec for whoever does it.

## What shipped to the website

On branch `claude/kind-wozniak-tzxz0m` of `ironclad-tech-website`:

- The inline mark in the header, footer and page loader across 25 pages
  (75 instances), at the same `viewBox` and the same `30×35` / `26×30`
  attributes, so nothing moved
- `favicon/favicon.svg` and every favicon PNG, plus `apple-touch-icon.png`
- `images/brand/*.svg` (5 rewritten, 1 added)
- `images/logo/*.png`, including the one the JSON-LD organisation logo points at
- `images/og-image.jpg`, rebuilt on `#07162A` instead of its old brighter blue

Still not produced: a `favicon.ico` (the site links PNGs only, so nothing
needs it), and stacked/horizontal lock-ups as standalone SVG files — the site
composes the lock-up from the mark plus live text, which is the better form.

## Open question still outstanding

**Is the I/T gap acceptable?** It departs from the original artwork, which runs
the two top bars together. Everything shipped above uses the gapped version.
Changing it later is a one-line path edit in each file, not a redraw.
