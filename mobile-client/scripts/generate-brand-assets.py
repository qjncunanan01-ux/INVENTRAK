#!/usr/bin/env python3
"""Generate INVENTRAK brand assets (icon, adaptive icon, splash, favicon).

Pure-Python (PIL) so it runs anywhere without Node tooling. Outputs PNGs
into mobile-client/assets/ and wires nothing itself — app.json references
these files. Re-run any time you change the palette or wordmark.

Palette matches the app: lime #81c738, dark #111a0d, white.
"""
import os
from PIL import Image, ImageDraw, ImageFont

LIME = (129, 199, 56, 255)      # #81c738
LIME_BRIGHT = (136, 212, 49, 255)  # #88d431 (splash accent)
DARK = (17, 26, 13, 255)        # #111a0d
WHITE = (255, 255, 255, 255)

OUT = os.path.join(os.path.dirname(__file__), "..", "assets")
os.makedirs(OUT, exist_ok=True)

# Font fallback chain (Windows Arial Bold -> Segoe UI Bold -> PIL's DejaVu).
def load_font(size):
    candidates = [
        "C:/Windows/Fonts/arialbd.ttf",
        "C:/Windows/Fonts/segoeuib.ttf",
        "C:/Windows/Fonts/arial.ttf",
    ]
    for c in candidates:
        if os.path.exists(c):
            try:
                return ImageFont.truetype(c, size)
            except Exception:
                pass
    try:
        from PIL import ImageFont as _f
        return _f.load_default(size)
    except Exception:
        return ImageFont.load_default()

def fit_font(text, max_w, max_h, start=320, min_size=20):
    """Largest font size whose rendered text fits max_w x max_h."""
    size = start
    while size > min_size:
        f = load_font(size)
        x0, y0, x1, y1 = f.getbbox(text)
        if (x1 - x0) <= max_w and (y1 - y0) <= max_h:
            return f, (x0, y0, x1, y1)
        size -= 4
    f = load_font(min_size)
    return f, f.getbbox(text)

def center_text(draw, xy, text, font, bbox, fill):
    """Draw text centered on the given point (cx, cy)."""
    cx, cy = xy
    x0, y0, x1, y1 = bbox
    w, h = x1 - x0, y1 - y0
    draw.text((cx - w / 2 - x0, cy - h / 2 - y0), text, font=font, fill=fill)

def wordmark_image(size, fg, bg=None, radius=None, max_w_ratio=0.86, max_h_ratio=0.42):
    """Square image: optional bg rounded-rect + centered wordmark."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if bg is not None:
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=size // 6 if radius is None else radius, fill=bg)
    font, bbox = fit_font("INVENTRAK", size * max_w_ratio, size * max_h_ratio)
    center_text(d, (size / 2, size / 2), "INVENTRAK", font, bbox, fg)
    return img

# ---- 1. Legacy icon: 1024x1024 FULL lime square + white wordmark.
#        Legacy launcher icons must be full-bleed (no rounded corners / no
#        transparency — the launcher applies its own mask). ----
icon = wordmark_image(1024, WHITE, LIME, radius=0)
icon.save(os.path.join(OUT, "icon.png"))

# ---- 2. Adaptive icon foreground: 1024x1024 transparent + white glyph
#        kept inside the safe zone (center ~66%) so the launcher mask
#        (circle/squircle) never clips it. Background color is set in
#        app.json (adaptiveIcon.backgroundColor = lime). ----
adaptive = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
ad = ImageDraw.Draw(adaptive)
safe = 1024 * 0.62  # glyph box within the 66% safe zone
font, bbox = fit_font("INVENTRAK", safe, safe * 0.32)
center_text(ad, (512, 512), "INVENTRAK", font, bbox, WHITE)
adaptive.save(os.path.join(OUT, "adaptive-icon.png"))

# ---- 3. Splash: 1284x2778 dark bg, lime wordmark + white tagline ----
W, H = 1284, 2778
splash = Image.new("RGBA", (W, H), DARK)
sd = ImageDraw.Draw(splash)
f_main, b_main = fit_font("INVENTRAK", W * 0.8, 420, start=340)
center_text(sd, (W / 2, H * 0.42), "INVENTRAK", f_main, b_main, LIME_BRIGHT)
f_tag, b_tag = fit_font("Inventory Management System", W * 0.62, 120, start=110, min_size=36)
center_text(sd, (W / 2, H * 0.42 + 260), "Inventory Management System", f_tag, b_tag, WHITE)
splash.save(os.path.join(OUT, "splash.png"))

# ---- 4. Favicon: 48x48 lime rounded square + white "I" ----
fav = Image.new("RGBA", (48, 48), (0, 0, 0, 0))
fd = ImageDraw.Draw(fav)
fd.rounded_rectangle([0, 0, 47, 47], radius=10, fill=LIME)
f_fav, b_fav = fit_font("I", 40, 40, start=40, min_size=24)
center_text(fd, (24, 24), "I", f_fav, b_fav, WHITE)
fav.save(os.path.join(OUT, "favicon.png"))

for name in ("icon.png", "adaptive-icon.png", "splash.png", "favicon.png"):
    p = os.path.join(OUT, name)
    with Image.open(p) as im:
        print(f"{name}: {im.size[0]}x{im.size[1]} {os.path.getsize(p)} bytes")
print("done ->", os.path.abspath(OUT))
