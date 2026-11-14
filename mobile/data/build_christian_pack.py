"""Builds christian-pictures-v1.zip (the release `backgrounds-christian-v1`) from the owner's 55 Unsplash downloads (read only): backgrounds.json, full/<id>.jpg (1600 px long side, aspect kept),
thumb/<id>.jpg (180 px square, middle). Same layout as the nature pack, so the app reads it the same way."""
import os, glob, json, zipfile, hashlib, io, re
from PIL import Image, ImageOps

# the photographs are downloaded by hand from Unsplash into this folder (it is git-ignored: `installer/`)
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "..", "installer", "other pics")
OUT_DIR = os.path.join(HERE, "..", "..", "installer", "christian-pack")
os.makedirs(OUT_DIR, exist_ok=True)
ZIP = os.path.join(OUT_DIR, "christian-pictures-v1.zip")

# (theme, short title) in the order of the sorted file names
INFO = [
    ("cross", "Wooden cross against a blue sky"),
    ("cross", "Cross silhouette in pink clouds"),
    ("cross", "Cross against an orange sky"),
    ("prayer", "A man kneeling in prayer in the mist"),
    ("cross", "Cross at dusk on the plain"),
    ("church", "Church steeple in black and white"),
    ("worship", "Arms open in a golden field"),
    ("with words", "Thank you God sign"),
    ("with words", "I am with you in letter tiles"),
    ("with words", "King of Kings flag"),
    ("communion", "Bread and the cup"),
    ("worship", "Raised hands in worship"),
    ("cross", "Neon cross over the city lights"),
    ("worship", "Worship under blue lights"),
    ("with words", "Jesus loves you shirt"),
    ("church", "Chapel on a snowy hill"),
    ("cross", "Three crosses above the lake"),
    ("cross", "Cross in the golden mist"),
    ("cross", "Cross at sunset over the mountains"),
    ("cross", "Wooden cross above the valley"),
    ("stained glass", "Light through a stained glass window"),
    ("cross", "Small cross in the dark"),
    ("cross", "Cross at sunset with a kneeling figure"),
    ("christmas", "Christmas candy canes and lights"),
    ("bible", "Reading the Bible by the water"),
    ("worship", "A hand raised in worship"),
    ("with words", "Only Jesus"),
    ("with words", "Jesus Christ is Lord"),
    ("cross", "Cross on a hilltop under clouds"),
    ("christmas", "Lantern with a red bow"),
    ("with words", "Jesus saves sign"),
    ("stained glass", "Nativity in stained glass"),
    ("with words", "He is risen"),
    ("christmas", "Two dogs and a Christmas wreath"),
    ("christmas", "Two dogs at a Christmas window"),
    ("with words", "Lifting a Jesus flag to the sky"),
    ("cross", "Cross at sunset with two walking"),
    ("church", "Angels painted on a ceiling"),
    ("worship", "Jesus in neon and raised hands"),
    ("with words", "Shalom in stained glass"),
    ("christmas", "A snowy street with garlands"),
    ("light", "Golden lights in the dark"),
    ("cross", "A cross and a heart drawn in the sand"),
    ("cross", "Wooden cross before the mountains"),
    ("cross", "A tiny cross in the dark"),
    ("bible", "You are loved on a Bible"),
    ("cross", "Neon cross equals heart"),
    ("lamb", "A lamb in the grass"),
    ("worship", "Worshippers with raised hands"),
    ("bible", "I am the way, the truth and the life"),
    ("christmas", "Red berries and a wreath"),
    ("with words", "God is faithful"),
    ("cross", "A cross painted on teal"),
    ("light", "A sparkler and golden lights"),
    ("cross", "Cross at sunrise on the rocks"),
]

# the photographer's name from the file name (best effort; the Unsplash page, by the photo's own code, is the true record)
FIX = {
    "jeshoots-com": "Jeshoots.com", "k-mitch-hodge": "K. Mitch Hodge", "neal-e-johnson": "Neal E. Johnson", "matthew-l": "Matthew L",
    "hugues-de-buyer-mimeure": "Hugues de Buyer-Mimeure", "luis-georg-muller": "Luis Georg Muller", "moritz-knoringer": "Moritz Knoringer",
}


def author_of(slug):
    if slug in FIX:
        return FIX[slug]
    return " ".join(w.capitalize() for w in slug.split("-"))


files = sorted(glob.glob(os.path.join(SRC, "*.jpg")))
assert len(files) == len(INFO), (len(files), len(INFO))
entries = []
zf = zipfile.ZipFile(ZIP, "w", zipfile.ZIP_DEFLATED)
total_full = 0
for n, (f, (theme, title)) in enumerate(zip(files, INFO), 1):
    name = os.path.basename(f)
    stem = name[: -len("-unsplash.jpg")]
    code = stem[-11:]
    slug = stem[:-11].rstrip("-")
    pid = "c%03d" % n
    with Image.open(f) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        k = min(1.0, 1600 / max(im.size))
        full = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS) if k < 1 else im
        buf = io.BytesIO()
        full.save(buf, "JPEG", quality=82, optimize=True, progressive=True)
        zf.writestr("full/%s.jpg" % pid, buf.getvalue())
        total_full += len(buf.getvalue())
        s = min(full.size)
        sq = full.crop(((full.width - s) // 2, (full.height - s) // 2, (full.width + s) // 2, (full.height + s) // 2)).resize((180, 180), Image.LANCZOS)
        tb = io.BytesIO()
        sq.save(tb, "JPEG", quality=80, optimize=True)
        zf.writestr("thumb/%s.jpg" % pid, tb.getvalue())
    entries.append({
        "id": pid, "theme": theme, "title": title, "author": author_of(slug), "licence": "Unsplash License",
        "source": "https://unsplash.com/photos/" + code,
    })
zf.writestr("backgrounds.json", json.dumps(entries, indent=1, ensure_ascii=False))
zf.close()
data = open(ZIP, "rb").read()
print("photos", len(entries), "| zip MB %.1f" % (len(data) / 1e6), "| SHA-256", hashlib.sha256(data).hexdigest())
from collections import Counter
print(Counter(e["theme"] for e in entries))
print(entries[16], entries[19])
