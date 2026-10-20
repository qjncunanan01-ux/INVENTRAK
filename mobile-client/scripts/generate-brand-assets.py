#!/usr/bin/env python3
"""Generate app icons from Sylver's supplied logo artwork.

Requires Pillow. Outputs PNGs into mobile-client/assets/; app.json references
these files. The original logo artwork remains the source of truth.
"""
import os
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), "..", "assets")
SYMBOL = os.path.join(OUT, "sylver-symbol.png")
LOGO = os.path.join(OUT, "sylver-logo.png")
WHITE = (255, 255, 255, 255)


def fit_on_canvas(source_path, width, height, max_width_ratio=0.84, max_height_ratio=0.84):
    """Scale supplied artwork to fit a centered canvas without cropping it."""
    with Image.open(source_path) as source:
        artwork = source.convert("RGBA")
    artwork.thumbnail(
        (int(width * max_width_ratio), int(height * max_height_ratio)),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGBA", (width, height), WHITE)
    canvas.alpha_composite(artwork, ((width - artwork.width) // 2, (height - artwork.height) // 2))
    return canvas


os.makedirs(OUT, exist_ok=True)

# Full-color app icons use the official Sylver symbol on white.
fit_on_canvas(SYMBOL, 1024, 1024).save(os.path.join(OUT, "icon.png"))
fit_on_canvas(SYMBOL, 1024, 1024, 0.62, 0.62).save(os.path.join(OUT, "adaptive-icon.png"))

# Keep the full company logo on the launch image; it includes the official
# Sylver wordmark and tagline supplied with the source artwork.
fit_on_canvas(LOGO, 1284, 2778, 0.82, 0.42).save(os.path.join(OUT, "splash.png"))
fit_on_canvas(SYMBOL, 48, 48, 0.9, 0.9).save(os.path.join(OUT, "favicon.png"))

for name in ("icon.png", "adaptive-icon.png", "splash.png", "favicon.png"):
    path = os.path.join(OUT, name)
    with Image.open(path) as image:
        print(f"{name}: {image.width}x{image.height} {os.path.getsize(path)} bytes")
print("done ->", os.path.abspath(OUT))
