"""
Generate high-DPI anti-aliased DeepSeek Blue Whale icons (icon.png, tray-icon.png, icon.ico)
using supersampling (4x scale + LANCZOS downsampling) via Pillow.
"""

import math
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
ASSETS_DIR = ROOT / "assets"


def bezier(p0, p1, p2, p3, steps=40):
    pts = []
    for i in range(steps + 1):
        t = i / steps
        mt = 1.0 - t
        x = (mt**3) * p0[0] + 3 * (mt**2) * t * p1[0] + 3 * mt * (t**2) * p2[0] + (t**3) * p3[0]
        y = (mt**3) * p0[1] + 3 * (mt**2) * t * p1[1] + 3 * mt * (t**2) * p2[1] + (t**3) * p3[1]
        pts.append((x, y))
    return pts


def draw_whale_master(size: int = 1024) -> Image.Image:
    """Render a crisp, cute DeepSeek blue whale mascot at high resolution."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    s = float(size)

    # Soft ambient ocean glow behind the whale
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow)
    gdraw.ellipse([s * 0.10, s * 0.16, s * 0.92, s * 0.90], fill=(37, 99, 255, 48))
    glow = glow.filter(ImageFilter.GaussianBlur(radius=s * 0.05))
    img = Image.alpha_composite(img, glow)

    # 1. Back pectoral fin (subtle darker royal blue behind belly)
    back_fin_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    bf_draw = ImageDraw.Draw(back_fin_layer)
    bf_poly = (
        bezier((s * 0.56, s * 0.70), (s * 0.62, s * 0.80), (s * 0.59, s * 0.86), (s * 0.52, s * 0.85), 20)
        + bezier((s * 0.52, s * 0.85), (s * 0.47, s * 0.82), (s * 0.46, s * 0.75), (s * 0.50, s * 0.69), 20)
    )
    bf_draw.polygon(bf_poly, fill=(15, 42, 186, 255))
    img = Image.alpha_composite(img, back_fin_layer)

    # 2. Sleek crescent split tail flukes (top-left)
    fluke_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    fl_draw = ImageDraw.Draw(fluke_layer)
    left_lobe = (
        bezier((s * 0.21, s * 0.44), (s * 0.12, s * 0.42), (s * 0.05, s * 0.34), (s * 0.05, s * 0.25), 24)
        + bezier((s * 0.05, s * 0.25), (s * 0.11, s * 0.27), (s * 0.17, s * 0.31), (s * 0.21, s * 0.36), 24)
    )
    right_lobe = (
        bezier((s * 0.21, s * 0.36), (s * 0.23, s * 0.28), (s * 0.28, s * 0.22), (s * 0.35, s * 0.21), 24)
        + bezier((s * 0.35, s * 0.21), (s * 0.34, s * 0.30), (s * 0.30, s * 0.39), (s * 0.23, s * 0.45), 24)
    )
    fl_draw.polygon(left_lobe, fill=(24, 70, 232, 255))
    fl_draw.polygon(right_lobe, fill=(45, 108, 255, 255))
    img = Image.alpha_composite(img, fluke_layer)

    # 3. Seamless organic whale body silhouette (DeepSeek Blue curvaeous whale)
    body_pts = (
        # Forehead & rounded melon snout (top -> front)
        bezier((s * 0.46, s * 0.33), (s * 0.68, s * 0.28), (s * 0.91, s * 0.38), (s * 0.92, s * 0.57), 36)
        # Chin & rounded belly (front -> bottom -> tail underside)
        + bezier((s * 0.92, s * 0.57), (s * 0.92, s * 0.76), (s * 0.68, s * 0.84), (s * 0.44, s * 0.76), 36)
        # Sweeping S-curve tail peduncle underside up to flukes
        + bezier((s * 0.44, s * 0.76), (s * 0.29, s * 0.70), (s * 0.20, s * 0.56), (s * 0.18, s * 0.42), 30)
        # Tail peduncle top edge back into dorsal back
        + bezier((s * 0.18, s * 0.42), (s * 0.23, s * 0.39), (s * 0.26, s * 0.49), (s * 0.46, s * 0.33), 30)
    )

    body_mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(body_mask).polygon(body_pts, fill=255)

    # Create rich vertical + diagonal DeepSeek blue gradient for body
    body_grad = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    bg_draw = ImageDraw.Draw(body_grad)
    y_min, y_max = int(s * 0.26), int(s * 0.85)
    for y in range(y_min, y_max):
        t = (y - y_min) / max(1, (y_max - y_min))
        r = int(66 * (1 - t) + 16 * t)
        g = int(133 * (1 - t) + 52 * t)
        b = int(255 * (1 - t) + 235 * t)
        bg_draw.line([(0, y), (size, y)], fill=(r, g, b, 255))

    # Cute dorsal fin merged onto back
    dorsal_pts = bezier((s * 0.41, s * 0.37), (s * 0.38, s * 0.27), (s * 0.42, s * 0.26), (s * 0.50, s * 0.34), 24)
    ImageDraw.Draw(body_mask).polygon(dorsal_pts, fill=255)

    body_grad.putalpha(body_mask)
    img = Image.alpha_composite(img, body_grad)

    # 4. Creamy polar-white belly + ventral pleats (clipped strictly inside body_mask!)
    belly_raw = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    bdraw = ImageDraw.Draw(belly_raw)
    belly_curve = (
        bezier((s * 0.30, s * 0.65), (s * 0.48, s * 0.57), (s * 0.77, s * 0.56), (s * 0.93, s * 0.62), 36)
        + [(s * 0.95, s * 0.90), (s * 0.25, s * 0.90)]
    )
    bdraw.polygon(belly_curve, fill=(240, 247, 255, 255))

    for offset in (0.62, 0.67, 0.72):
        pleat = bezier(
            (s * 0.37, s * (offset + 0.04)),
            (s * 0.54, s * (offset + 0.09)),
            (s * 0.74, s * (offset + 0.08)),
            (s * 0.87, s * (offset + 0.02)),
            28,
        )
        bdraw.line(pleat, fill=(138, 188, 252, 210), width=max(5, int(s * 0.012)))

    belly_alpha = belly_raw.getchannel("A")
    clipped_alpha = ImageChops.multiply(belly_alpha, body_mask)
    belly_raw.putalpha(clipped_alpha)
    img = Image.alpha_composite(img, belly_raw)

    # 5. Soft 3D specular highlight on forehead
    spec = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(spec)
    sdraw.ellipse([s * 0.53, s * 0.34, s * 0.81, s * 0.44], fill=(255, 255, 255, 92))
    spec = spec.filter(ImageFilter.GaussianBlur(radius=s * 0.008))
    img = Image.alpha_composite(img, spec)

    # 6. Teardrop near-side pectoral flipper
    fin_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    fdraw = ImageDraw.Draw(fin_layer)
    fin_pts = (
        bezier((s * 0.55, s * 0.61), (s * 0.46, s * 0.63), (s * 0.39, s * 0.73), (s * 0.42, s * 0.79), 24)
        + bezier((s * 0.42, s * 0.79), (s * 0.48, s * 0.81), (s * 0.58, s * 0.72), (s * 0.59, s * 0.64), 24)
    )
    fdraw.polygon(fin_pts, fill=(29, 82, 242, 255))
    fin_hi = bezier((s * 0.54, s * 0.63), (s * 0.47, s * 0.65), (s * 0.43, s * 0.72), (s * 0.44, s * 0.76), 18)
    fdraw.line(fin_hi, fill=(112, 172, 255, 165), width=max(4, int(s * 0.01)))
    img = Image.alpha_composite(img, fin_layer)

    # 7. Expressive glossy eye + rosy cheek + gentle smile
    face = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    edraw = ImageDraw.Draw(face)
    ex, ey = s * 0.75, s * 0.50
    er = s * 0.050
    edraw.ellipse([ex - er, ey - er, ex + er, ey + er], fill=(10, 20, 52, 255))
    ir = er * 0.68
    edraw.ellipse([ex - ir * 0.5, ey - ir * 0.3, ex + ir, ey + ir], fill=(37, 99, 235, 255))
    c1 = er * 0.35
    edraw.ellipse([ex - er * 0.45, ey - er * 0.48, ex - er * 0.45 + c1 * 2, ey - er * 0.48 + c1 * 2], fill=(255, 255, 255, 255))
    c2 = er * 0.16
    edraw.ellipse([ex + er * 0.18, ey + er * 0.16, ex + er * 0.18 + c2 * 2, ey + er * 0.16 + c2 * 2], fill=(255, 255, 255, 235))

    # Blush
    edraw.ellipse([s * 0.68, s * 0.55, s * 0.77, s * 0.60], fill=(255, 130, 172, 145))

    # Cute smile curve
    smile_pts = bezier((s * 0.79, s * 0.56), (s * 0.82, s * 0.60), (s * 0.86, s * 0.59), (s * 0.88, s * 0.55), 20)
    edraw.line(smile_pts, fill=(12, 29, 78, 240), width=max(6, int(s * 0.014)))

    # 8. Twin curved water spout fountain from blowhole!
    spout_left = bezier((s * 0.62, s * 0.30), (s * 0.61, s * 0.19), (s * 0.54, s * 0.14), (s * 0.48, s * 0.18), 24)
    spout_right = bezier((s * 0.64, s * 0.30), (s * 0.66, s * 0.18), (s * 0.73, s * 0.13), (s * 0.79, s * 0.17), 24)
    edraw.line(spout_left, fill=(96, 175, 255, 235), width=max(8, int(s * 0.020)))
    edraw.line(spout_right, fill=(56, 189, 248, 235), width=max(8, int(s * 0.020)))

    for dx, dy, dr, col in [
        (s * 0.46, s * 0.21, s * 0.018, (125, 211, 252, 240)),
        (s * 0.81, s * 0.20, s * 0.018, (96, 165, 250, 240)),
        (s * 0.63, s * 0.12, s * 0.022, (56, 189, 248, 245)),
    ]:
        edraw.ellipse([dx - dr, dy - dr, dx + dr, dy + dr], fill=col)

    img = Image.alpha_composite(img, face)
    return img


def main() -> None:
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    master = draw_whale_master(1024)

    icon_256 = master.resize((256, 256), Image.Resampling.LANCZOS)
    icon_256.save(ASSETS_DIR / "icon.png", format="PNG")

    tray_32 = master.resize((32, 32), Image.Resampling.LANCZOS)
    tray_32.save(ASSETS_DIR / "tray-icon.png", format="PNG")

    master.save(
        ASSETS_DIR / "icon.ico",
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print(f"Generated icons in {ASSETS_DIR}")


if __name__ == "__main__":
    main()
