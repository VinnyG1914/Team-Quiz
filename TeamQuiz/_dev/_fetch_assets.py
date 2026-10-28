"""One-off: download background photos (Unsplash licence), cartoon avatars (DiceBear) and the Montserrat font."""
import urllib.request, urllib.parse, pathlib, re, json

ROOT = pathlib.Path(__file__).resolve().parent.parent
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"}

def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read()

# ---- backgrounds ----
THEMES = {
    "galaxy": "1462331940025-496dfbfc7564",
    "night-sky": "1419242902214-272b3f66ee7a",
    "summit": "1506905925346-21bda4d32df4",
    "beach": "1507525428034-b723cf961d3e",
    "highlands": "1470071459604-3b5ec3a7fe05",
    "lake": "1501785888041-af3ef285b470",
    "mountain-lake": "1493246507139-91e8fad9978e",
    "city": "1477959858617-67f85cf4f1df",
    "party": "1514525253161-7a46d19cd819",
    "arcade": "1511512578047-dfb367046420",
}
bg = ROOT / "assets" / "bg"
(bg / "thumb").mkdir(parents=True, exist_ok=True)
for name, pid in THEMES.items():
    (bg / f"{name}.jpg").write_bytes(get(f"https://images.unsplash.com/photo-{pid}?w=1920&q=70&fm=jpg&fit=crop"))
    (bg / "thumb" / f"{name}.jpg").write_bytes(get(f"https://images.unsplash.com/photo-{pid}?w=360&h=200&q=60&fm=jpg&fit=crop"))
    print("bg", name, (bg / f"{name}.jpg").stat().st_size)

# ---- avatars ----
GROUPS = {
    "heroes": ("adventurer", "", ["Felix", "Aneka", "Jasper", "Luna", "Milo", "Nala", "Oscar", "Zoe"]),
    "cartoon": ("avataaars", "eyes=default,happy,hearts,side,squint,surprised,wink&mouth=default,smile,tongue,twinkle"
                "&eyebrows=default,defaultNatural,raisedExcited,raisedExcitedNatural,upDown,upDownNatural",
                ["Max", "Ruby", "Leo", "Ivy", "Sam", "Maya", "Theo", "Ella"]),
    "smiles": ("big-smile", "", ["Kiki", "Bruno", "Coco", "Dexter", "Gigi", "Hugo", "Penny", "Rocco"]),
    "toons": ("toon-head", "", ["Ace", "Bea", "Cy", "Dot", "Eli", "Fay", "Gus", "Hana"]),
    "robots": ("bottts", "", ["R2", "Bolt", "Chip", "Gizmo", "Spark", "Widget", "Byte", "Nova"]),
    "people": ("personas", "", ["Ann", "Ben", "Cara", "Dan", "Eve", "Finn", "Gina", "Hal"]),
}
for folder, (style, opts, seeds) in GROUPS.items():
    d = ROOT / "avatars" / folder
    d.mkdir(parents=True, exist_ok=True)
    for s in seeds:
        q = f"seed={urllib.parse.quote(s)}" + (("&" + opts) if opts else "")
        (d / f"{s.lower()}.svg").write_bytes(get(f"https://api.dicebear.com/9.x/{style}/svg?{q}"))
    print("avatars", folder, len(seeds))

# ---- font (SIL Open Font Licence) ----
css = get("https://fonts.googleapis.com/css2?family=Montserrat:wght@500..900&display=swap").decode()
blocks = re.findall(r"/\* (\w[\w-]*) \*/\s*@font-face\s*{([^}]*)}", css)
for subset, body in blocks:
    if subset == "latin":
        url = re.search(r"url\((https://[^)]+\.woff2)\)", body).group(1)
        (ROOT / "fonts").mkdir(exist_ok=True)
        (ROOT / "fonts" / "montserrat.woff2").write_bytes(get(url))
        print("font", (ROOT / "fonts" / "montserrat.woff2").stat().st_size)
print("done")
