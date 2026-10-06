#!/bin/bash
# Render every frozen frame, then encode alpha video in two formats.
set -u
SCRATCH=/tmp/claude-0/-home-user-claude-work1/2357a8fe-4ab8-5d2f-b2ea-2560df6eb85c/scratchpad
SH=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell
OUT=/home/user/claude-work1/brand/video
mkdir -p "$SCRATCH/png" "$OUT"
rm -f "$SCRATCH/png"/f*.png

n=0
for f in "$SCRATCH"/frames/f*.html; do
  b=$(basename "$f" .html)
  "$SH" --no-sandbox --disable-gpu --hide-scrollbars \
        --default-background-color=00000000 \
        --window-size=1920,1080 --virtual-time-budget=1200 \
        --screenshot="$SCRATCH/png/$b.png" "file://$f" 2>/dev/null
  n=$((n+1))
done
echo "rendered $n frames"
ls "$SCRATCH"/png/f*.png | wc -l

# WebM / VP9 with alpha - drops straight into web and most NLEs
ffmpeg -y -hide_banner -loglevel error -framerate 30 \
  -i "$SCRATCH/png/f%04d.png" \
  -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 28 -row-mt 1 \
  "$OUT/ironclad-intro-alpha.webm"

# ProRes 4444 - for After Effects / Premiere / Resolve
ffmpeg -y -hide_banner -loglevel error -framerate 30 \
  -i "$SCRATCH/png/f%04d.png" \
  -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le -alpha_bits 16 \
  "$OUT/ironclad-intro-alpha.mov"

# Flattened H.264 on the site navy, for anything that cannot take alpha
ffmpeg -y -hide_banner -loglevel error -f lavfi -i color=c=0x07162A:s=1920x1080:r=30 \
  -framerate 30 -i "$SCRATCH/png/f%04d.png" \
  -filter_complex "[0:v][1:v]overlay=shortest=1,format=yuv420p" \
  -c:v libx264 -crf 18 -preset slow "$OUT/ironclad-intro-navy.mp4"

echo "--- output ---"
ls -la "$OUT"
