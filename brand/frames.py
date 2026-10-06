"""Write one HTML per frame of the intro, with the CSS timeline frozen at that
instant. Each animation keeps its easing and duration; only its delay is
shifted by -T and the animation is paused, so the browser renders exactly the
state the live animation would show at time T."""
import pathlib

OUT = pathlib.Path('/tmp/claude-0/-home-user-claude-work1/'
                   '2357a8fe-4ab8-5d2f-b2ea-2560df6eb85c/scratchpad/frames')
OUT.mkdir(exist_ok=True)

W, H, FPS, RUN, HOLD = 1920, 1080, 30, 1.90, 0.60

SHIELD = ('M10 14 H110 A4 4 0 0 1 114 18 V66 C114 100 94 124 60 136 '
          'C26 124 6 100 6 66 V18 A4 4 0 0 1 10 14 Z')
KNOCK = 'M20 25 H100 V66 C100 91 86 109 60 118 C34 109 20 91 20 66 Z'
GI = 'M27 34 H53 V46 H45 V84 H51 V95 H29 V84 H35 V46 H27 Z'
GT = 'M57 34 H93 V46 H81 V104 H69 V46 H57 Z'

# (class, keyframe, duration, delay, easing) — identical to brand/intro.html
TIMELINE = [
    ('ishield', 'draw',   0.56, 0.00, 'cubic-bezier(.5,0,.2,1)'),
    ('igold',   'flood',  0.40, 0.39, 'ease-out'),
    ('igold',   'molten', 0.62, 0.39, 'ease-out'),
    ('imono',   'stamp',  0.36, 0.72, 'cubic-bezier(.3,1.5,.4,1)'),
    ('isweep',  'sweep',  0.70, 0.94, 'cubic-bezier(.4,0,.3,1)'),
    ('iwm',     'track',  0.50, 1.02, 'cubic-bezier(.22,.9,.25,1)'),
    ('itech',   'fadeup', 0.40, 1.28, 'ease-out'),
    ('itag',    'fadeup', 0.40, 1.46, 'ease-out'),
]

KEYFRAMES = """
@keyframes draw{from{stroke-dashoffset:1000}to{stroke-dashoffset:0}}
@keyframes flood{from{opacity:0;clip-path:inset(100% 0 0 0)}to{opacity:1;clip-path:inset(0 0 0 0)}}
@keyframes molten{0%{filter:drop-shadow(0 0 0 rgba(244,211,94,0))}45%{filter:drop-shadow(0 0 16px rgba(244,211,94,.85))}100%{filter:drop-shadow(0 0 4px rgba(212,175,55,.25))}}
@keyframes stamp{from{opacity:0;transform:scale(1.55)}to{opacity:1;transform:scale(1)}}
@keyframes sweep{from{opacity:.95;transform:translateX(-45px) skewX(-16deg)}65%{opacity:.95}to{opacity:0;transform:translateX(140px) skewX(-16deg)}}
@keyframes track{from{opacity:0;letter-spacing:.42em}to{opacity:1;letter-spacing:.015em}}
@keyframes fadeup{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:none}}
"""

BODY = f'''<div class="lock" id="intro">
  <svg viewBox="0 0 120 140" width="360" height="420" style="overflow:visible">
    <defs>
      <linearGradient id="gFlat" x1="0" y1="0" x2=".35" y2="1">
        <stop offset="0" stop-color="#E8CE72"/><stop offset=".5" stop-color="#D4AF37"/>
        <stop offset="1" stop-color="#B08E22"/>
      </linearGradient>
      <linearGradient id="gSweep" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#fff" stop-opacity="0"/>
        <stop offset=".5" stop-color="#fff" stop-opacity=".85"/>
        <stop offset="1" stop-color="#fff" stop-opacity="0"/>
      </linearGradient>
      <clipPath id="cShield"><path d="{SHIELD}"/></clipPath>
    </defs>
    <path class="ishield" pathLength="1000" fill="none" stroke="#D4AF37" stroke-width="3"
          stroke-linejoin="round" d="{SHIELD}"/>
    <path class="igold" fill-rule="evenodd" fill="url(#gFlat)" d="{SHIELD} {KNOCK}"/>
    <g class="imono"><path fill="url(#gFlat)" d="{GI}"/><path fill="url(#gFlat)" d="{GT}"/></g>
    <g clip-path="url(#cShield)"><rect class="isweep" x="0" y="-25" width="26" height="195" fill="url(#gSweep)"/></g>
  </svg>
  <span class="wm iwm">IRONCLAD</span>
  <span class="techline itech"><span class="rule"></span><span>TECH</span><span class="rule r"></span></span>
  <span class="tagfix itag">Built on Trust. Powered by Technology.</span>
</div>'''

FONTS = ("<link rel=stylesheet href='https://fonts.googleapis.com/css2?"
         "family=Space+Grotesk:wght@500;700&family=IBM+Plex+Mono:wght@500&display=swap'>")

STATIC = f"""
html,body{{margin:0;padding:0;width:{W}px;height:{H}px;overflow:hidden;background:transparent}}
svg{{display:block}}
.lock{{width:{W}px;height:{H}px;display:flex;flex-direction:column;
      align-items:center;justify-content:center;gap:34px}}
.wm{{font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:118px;color:#fff;line-height:1}}
.techline{{display:flex;align-items:center;gap:30px;width:760px}}
.techline .rule{{flex:1;height:2px;background:linear-gradient(90deg,transparent,#D4AF37)}}
.techline .rule.r{{background:linear-gradient(90deg,#D4AF37,transparent)}}
.techline span{{font-family:'Space Grotesk',sans-serif;font-weight:500;font-size:44px;
  letter-spacing:.44em;text-indent:.44em;color:#D4AF37}}
.tagfix{{font-family:'IBM Plex Mono',monospace;font-weight:500;font-size:28px;
  letter-spacing:.165em;text-transform:uppercase;color:#C9B37E}}
.imono{{transform-origin:60px 70px}}
{KEYFRAMES}
"""

n_frames = round((RUN + HOLD) * FPS)
for i in range(n_frames):
    t = min(i / FPS, RUN)
    by_sel = {}
    for cls, kf, dur, delay, ease in TIMELINE:
        by_sel.setdefault(cls, []).append(f'{kf} {dur}s {ease} {delay - t:.4f}s both')
    rules = '\n'.join(
        f'#intro .{cls}{{animation:{", ".join(parts)};animation-play-state:paused}}'
        for cls, parts in by_sel.items())
    (OUT / f'f{i:04d}.html').write_text(
        f'<!doctype html><meta charset=utf-8>{FONTS}<style>{STATIC}\n{rules}</style>{BODY}',
        encoding='utf-8')

print(f'{n_frames} frames at {FPS}fps ({RUN}s run + {HOLD}s hold), {W}x{H}')
