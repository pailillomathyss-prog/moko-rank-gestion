"""Réimporter les petites illustrations officielles, avec validation PNG et hash."""
import hashlib
import io
import json
from pathlib import Path
from urllib.request import urlopen

from PIL import Image

root = Path(__file__).resolve().parent.parent
rows = json.loads((root / "assets" / "questions.json").read_text())
hashes = {}
for row in rows:
    filename = row["asset"]
    url = f"https://raw.githubusercontent.com/twitter/twemoji/v14.0.2/assets/72x72/{filename}"
    with urlopen(url, timeout=30) as response:
        data = response.read()
    with Image.open(io.BytesIO(data)) as image:
        assert image.format == "PNG", filename
        image.verify()
    digest = hashlib.sha256(data).hexdigest()
    assert digest not in hashes.values(), f"Image dupliquée : {filename}"
    (root / "assets" / filename).write_bytes(data)
    hashes[filename] = digest
(root / "assets" / "checksums.json").write_text(json.dumps(hashes, indent=2) + "\n")
print(f"{len(rows)} illustrations vérifiées et sauvegardées.")
