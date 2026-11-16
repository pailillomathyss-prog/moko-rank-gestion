"""Fetch, attribute, optimize and verify freely licensed real photographs via Openverse."""
import hashlib
import io
import json
import re
import time
import urllib.parse
from pathlib import Path
from urllib.request import Request, urlopen

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
TERMS = {
    "elephant":("African elephant wildlife","elephant"),
    "lion":("wild lion wildlife animal","lion"),
    "chat":("domestic cat animal","cat"),
    "chien":("pet dog animal","dog"),
    "lapin":("rabbit animal","rabbit"),
    "tortue":("sea turtle swimming","turtle"),
    "papillon":("monarch butterfly insect","butterfly"),
    "dauphin":("dolphins swimming ocean","dolphin"),
    "grenouille":("green frog animal","frog"),
    "girafe":("giraffe animal","giraffe"),
    "pomme":("red apple fresh fruit","apple"),
    "banane":("yellow banana fruit","banana"),
    "fraise":("strawberry red fruit","strawberry"),
    "ananas":("whole pineapple fruit","pineapple"),
    "pastèque":("watermelon fruit sliced","watermelon"),
    "citron":("yellow lemon fruit","lemon"),
    "carotte":("fresh orange carrot vegetable","carrot"),
    "pizza":("cheese pizza slice","pizza"),
    "croissant":("plain butter croissant pastry","croissant"),
    "fromage":("swiss cheese wedge holes","cheese"),
    "velo":("bicycle parked bicycle","bicycle"),
    "parapluie":("open umbrella in rain","umbrella"),
    "cle":("metal house door key","key"),
    "reveil":("analog alarm clock","clock"),
    "ciseaux":("metal scissors tool","scissors"),
    "guitare":("acoustic guitar instrument","guitar"),
    "livre":("open book pages","book"),
    "ballon":("soccer football ball isolated","ball"),
    "soleil":("sun setting sky","sun"),
    "arcenciel":("rainbow arc sky landscape","rainbow"),
}
HEADERS = {"User-Agent":"DiscordGuessingGame/1.0 (free Creative Commons photo selection)"}
ALLOWED_LICENSES = {"cc0", "by", "by-sa"}


def request_json(url):
    request = Request(url, headers=HEADERS)
    for attempt in range(5):
        try:
            with urlopen(request, timeout=40) as response:
                return json.load(response)
        except Exception:
            if attempt == 4:
                raise
            time.sleep(min(30, 2 ** (attempt + 1)))


def download(url):
    request = Request(url, headers=HEADERS)
    for attempt in range(5):
        try:
            with urlopen(request, timeout=40) as response:
                return response.read()
        except Exception:
            if attempt == 4:
                raise
            time.sleep(min(30, 2 ** (attempt + 1)))


def select(results, keyword, used):
    candidates = [
        item for item in results
        if item.get("license", "").casefold() in ALLOWED_LICENSES
        and re.search(rf"\b{re.escape(keyword.casefold())}\b", item.get("title", "").casefold())
        and item.get("thumbnail") and item.get("width", 0) >= 320 and item.get("height", 0) >= 240
        and item.get("url") not in used
    ]
    # Prefer concise, clearly labelled photos over posters, collages and documents.
    candidates.sort(key=lambda item: (
        len(item["title"]) < 80,
        item.get("source", "").casefold() != "wikimedia",
        -len(item["title"]),
    ), reverse=True)
    return candidates[0] if candidates else None


def clean(value):
    return re.sub(r"<[^>]*>", "", value or "").strip()


def main():
    bank_path = ROOT / "assets" / "questions.json"
    questions = json.loads(bank_path.read_text())
    if {row["key"] for row in questions} != set(TERMS):
        raise SystemExit("La banque a changé : vérifie les mots-clés des photos.")
    photo_dir = ROOT / "assets" / "photos"
    photo_dir.mkdir(parents=True, exist_ok=True)
    credit_path = ROOT / "assets" / "photo-attribution.json"
    checksum_path = ROOT / "assets" / "checksums.json"
    credits = json.loads(credit_path.read_text()) if credit_path.exists() else {}
    all_checksums = json.loads(checksum_path.read_text()) if checksum_path.exists() else {}
    checksums = {k:v for k,v in all_checksums.items() if k.startswith("photos/")}
    used = {c.get("source") for c in credits.values()}
    for row in questions:
        phrase, keyword = TERMS[row["key"]]
        filename = f"photos/{row['key']}.jpg"
        local = ROOT / "assets" / filename
        if row["key"] in credits and local.exists() and checksums.get(filename) == hashlib.sha256(local.read_bytes()).hexdigest():
            row["asset"] = filename
            continue
        query = urllib.parse.urlencode({
            "q":phrase, "license":"cc0,by,by-sa", "page_size":20,
            "mature":"false", "format":"json",
        })
        data = request_json(f"https://api.openverse.org/v1/images/?{query}")
        choice = select(data.get("results", []), keyword, used)
        if not choice:
            fallback = urllib.parse.urlencode({
                "q":keyword, "license":"cc0,by,by-sa", "page_size":20,
                "mature":"false", "format":"json",
            })
            data = request_json(f"https://api.openverse.org/v1/images/?{fallback}")
            choice = select(data.get("results", []), keyword, used)
        if not choice:
            raise SystemExit(f"Aucune photo gratuite et correctement identifiée pour « {row['answer']} ».")
        raw = download(choice["thumbnail"])
        with Image.open(io.BytesIO(raw)) as image:
            image.verify()
        with Image.open(io.BytesIO(raw)) as image:
            photo = ImageOps.fit(image.convert("RGB"), (600, 420), method=Image.Resampling.LANCZOS)
        buffer = io.BytesIO()
        photo.save(buffer, "JPEG", quality=82, optimize=True, progressive=True)
        encoded = buffer.getvalue()
        filename = f"photos/{row['key']}.jpg"
        digest = hashlib.sha256(encoded).hexdigest()
        if digest in checksums.values():
            raise SystemExit(f"Photo répétée pour « {row['answer']} ».")
        (ROOT / "assets" / filename).write_bytes(encoded)
        row["asset"] = filename
        checksums[filename] = digest
        credits[row["key"]] = {
            "title":clean(choice.get("title")), "author":clean(choice.get("creator")),
            "license":choice["license"], "license_version":choice.get("license_version"),
            "license_url":choice.get("license_url"),
            "source":choice.get("foreign_landing_url"),
        }
        used.add(choice["url"])
        bank_path.write_text(json.dumps(questions, ensure_ascii=False, indent=2) + "\n")
        all_checksums.update(checksums)
        checksum_path.write_text(json.dumps(all_checksums, indent=2) + "\n")
        credit_path.write_text(json.dumps(credits, ensure_ascii=False, indent=2) + "\n")
        print(f"{row['answer']} : {credits[row['key']]['license']} — {credits[row['key']]['title']}")
        time.sleep(0.6)
    print(f"{len(checksums)} photos uniques sous licences libres.")


if __name__ == "__main__":
    main()
