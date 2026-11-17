# Contact sheets. usage: contact.py <proj> page <route_slug> <mode> | theme <skin> <mode>
import sys, glob, os
from PIL import Image, ImageDraw
proj, kind, a, mode = sys.argv[1:5]
d = f'/tmp/cohesion-shots/{proj}'
SK = 'canopy paper grimoire pop arcade sumi bauhaus riso blueprint swiss collage rings cyberpunk'.split()
RT = 'today habits tasks rejections gym one journal books entertainment rewards settings'.split()
items = [(s, f'{d}/_{a}-{s}-{mode}.png') for s in SK] if kind == 'page' else [(r, f'{d}/_{r}-{a}-{mode}.png') for r in RT]
ims = [(n, Image.open(p)) for n, p in items if os.path.exists(p)]
W = 360 if proj == 'phone' else 640
cols = 7 if proj == 'phone' else 4
ims = [(n, i.resize((W, int(i.height * W / i.width)))) for n, i in ims]
H = max(i.height for _, i in ims)
rows = (len(ims) + cols - 1) // cols
S = Image.new('RGB', (cols * W, rows * (H + 18)), 'white'); dr = ImageDraw.Draw(S)
for k, (n, i) in enumerate(ims):
    x, y = (k % cols) * W, (k // cols) * (H + 18)
    dr.text((x + 4, y + 3), n, fill='black'); S.paste(i, (x, y + 18))
out = f'/tmp/cohesion-shots/sheet-{proj}-{kind}-{a}-{mode}.png'; S.save(out); print(out, S.size)
