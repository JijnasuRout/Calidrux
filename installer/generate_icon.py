"""Generate application icon for Windows installer."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

out = Path(__file__).parent / "calidrux.ico"
size = 256
img = Image.new("RGBA", (size, size), (26, 86, 140, 255))
draw = ImageDraw.Draw(img)
draw.rounded_rectangle([24, 24, size - 24, size - 24], radius=32, fill=(52, 152, 219, 255))
draw.text((size // 2 - 40, size // 2 - 30), "Cx", fill="white")
img.save(out, format="ICO", sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
print(f"Wrote {out}")
