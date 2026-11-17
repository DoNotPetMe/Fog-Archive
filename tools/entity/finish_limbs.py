# Turns the raw Blender renders into the sprites the site uses.
#
#   python tools/entity/finish_limbs.py <raw_dir> <site/assets/ui>
#
# Adds a soft ember glow around the glowing cracks, trims the off-screen stump,
# and writes limb-a/b/c.webp (full limbs) and claw.webp (a tip, for card corners).

import sys
import numpy as np
from PIL import Image, ImageFilter

raw_dir, out_dir = sys.argv[1], sys.argv[2]


def finish(name):
    im = Image.open(f'{raw_dir}/limb-{name}-raw.png').convert('RGBA')
    a = np.asarray(im).astype(np.float32) / 255.0
    rgb, alpha = a[..., :3], a[..., 3:4]
    # emissive = bright and strongly orange (red well above blue)
    heat = np.clip((rgb[..., 0] - rgb[..., 2] * 1.6 - 0.25) * 2.2, 0, 1)[..., None] * alpha
    glow_src = Image.fromarray((np.clip(rgb * heat, 0, 1) * 255).astype(np.uint8))
    glow = np.zeros_like(rgb)
    for radius, gain in ((6, 0.9), (18, 0.7), (44, 0.5)):
        glow += np.asarray(glow_src.filter(ImageFilter.GaussianBlur(radius))).astype(np.float32) / 255.0 * gain
    glow = np.clip(glow, 0, 1)
    glow_a = np.clip(glow.max(axis=2, keepdims=True) * 1.15, 0, 1)
    # composite: glow behind and around the limb (premultiplied "over", then screen the glow on top lightly)
    out_a = alpha + glow_a * (1 - alpha)
    out_rgb = (rgb * alpha + (glow / np.maximum(glow_a, 1e-4)) * glow_a * (1 - alpha)) / np.maximum(out_a, 1e-4)
    out_rgb = 1 - (1 - out_rgb) * (1 - glow * 0.35 * alpha)  # bloom over the shell
    res = np.concatenate([np.clip(out_rgb, 0, 1), np.clip(out_a, 0, 1)], axis=2)
    img = Image.fromarray((res * 255).astype(np.uint8), 'RGBA')
    # trim the rounded stump (it sits off-screen) and empty margins
    w, h = img.size
    img = img.crop((int(w * 0.075), 0, w, h))
    box = Image.fromarray((np.asarray(img)[..., 3] > 6).astype(np.uint8) * 255).getbbox()
    img = img.crop((0, max(0, box[1] - 8), min(img.width, box[2] + 8), min(img.height, box[3] + 8)))
    return img


claw_src = None
for name in 'abc':
    img = finish(name)
    full = img.copy()
    full.thumbnail((1000, 1000), Image.LANCZOS)
    full.save(f'{out_dir}/limb-{name}.webp', 'WEBP', quality=80, method=6)
    print(name, full.size)
    if name == 'a':
        claw_src = img

# the claw: the last third of limb A (the stabbing tip), for card corners
w, h = claw_src.size
tip = claw_src.crop((int(w * 0.60), int(h * 0.30), w, h))
box = Image.fromarray((np.asarray(tip)[..., 3] > 6).astype(np.uint8) * 255).getbbox()
tip = tip.crop(box)
tip.thumbnail((260, 260), Image.LANCZOS)
tip.save(f'{out_dir}/claw.webp', 'WEBP', quality=80, method=6)
print('claw', tip.size)
