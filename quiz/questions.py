"""Banque locale, rendu des images et comparaison prudente des réponses."""
from __future__ import annotations

import io
import hashlib
import json
import random
import re
import unicodedata
from dataclasses import asdict, dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent


def normalize(value: str) -> str:
    value = unicodedata.normalize("NFKD", value.casefold().replace("œ", "oe"))
    value = "".join(c for c in value if not unicodedata.combining(c))
    value = re.sub(r"[^a-z0-9\s-]", " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    value = re.sub(r"^(?:un|une|le|la|les|des|du|de|l)\s+", "", value)
    return value


def one_edit(a: str, b: str) -> bool:
    """Distance de Levenshtein <= 1, sans accepter des réponses multiples."""
    if abs(len(a) - len(b)) > 1:
        return False
    if len(a) == len(b):
        return sum(x != y for x, y in zip(a, b)) <= 1
    if len(a) > len(b):
        a, b = b, a
    index = next((i for i in range(len(a)) if a[i] != b[i]), len(a))
    return a[index:] == b[index + 1:]


@dataclass(frozen=True)
class Question:
    key: str
    category: str
    answer: str
    aliases: list[str]
    asset: str | None = None
    expression: str | None = None

    def matches(self, text: str) -> bool:
        if len(text) > 100:
            return False
        if self.expression:
            # Exact numerical result only; never eval() user input.
            value = text.strip().replace(",", ".")
            return bool(re.fullmatch(r"[+-]?\d+(?:\.0+)?", value)) and float(value) == int(self.answer)
        value = normalize(text)
        for alias in [self.answer, *self.aliases]:
            expected = normalize(alias)
            if value == expected or value == expected + "s":
                return True
            if min(len(value), len(expected)) >= 5 and value.count(" ") == expected.count(" ") and one_edit(value, expected):
                return True
        return False

    def serialize(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False)

    @classmethod
    def deserialize(cls, value: str) -> Question:
        return cls(**json.loads(value))

    def image(self) -> bytes:
        """PNG autonome, sans réponse dans le nom ni dans les métadonnées."""
        canvas = Image.new("RGB", (800, 560), "#101827")
        draw = ImageDraw.Draw(canvas)
        draw.rounded_rectangle((24, 24, 776, 536), radius=32, fill="#f4f7fc")
        if self.expression:
            # Pillow's bundled font has no multiplication-sign glyph.
            formula = f"{self.expression.replace('×', 'x')} = ?"
            draw.text((400, 285), formula, font=ImageFont.load_default(size=76), fill="#172743", anchor="mm")
        else:
            with Image.open(ROOT / "assets" / self.asset) as source:
                picture = source.convert("RGBA").resize((320, 320), Image.Resampling.LANCZOS)
                canvas.paste(picture, (240, 130), picture)
        buffer = io.BytesIO()
        canvas.save(buffer, format="PNG")
        return buffer.getvalue()


class QuestionBank:
    def __init__(self, rng=None):
        self.rng = rng or random.Random()
        self.questions = [Question(**row) for row in json.loads((ROOT / "assets" / "questions.json").read_text())]
        checksums = json.loads((ROOT / "assets" / "checksums.json").read_text())
        if len({q.key for q in self.questions}) != len(self.questions):
            raise ValueError("Clés de devinettes dupliquées.")
        seen = set()
        for q in self.questions:
            digest = hashlib.sha256((ROOT / "assets" / q.asset).read_bytes()).hexdigest()
            if checksums.get(q.asset) != digest or digest in seen:
                raise ValueError(f"Image modifiée ou dupliquée : {q.asset}")
            seen.add(digest)
            with Image.open(ROOT / "assets" / q.asset) as image:
                image.verify()

    def choose(self, recent: list[str]) -> Question:
        if self.rng.randrange(5) == 0:
            for _ in range(100):
                a, b = self.rng.randint(2, 30), self.rng.randint(2, 12)
                op = self.rng.choice(["+", "-", "×"])
                if op == "-":
                    a, b = max(a, b), min(a, b)
                result = a + b if op == "+" else a - b if op == "-" else a * b
                key = f"math:{a}{op}{b}"
                if key not in recent:
                    return Question(key, "Calcul", str(result), [], expression=f"{a} {op} {b}")
        options = [q for q in self.questions if q.key not in recent] or self.questions
        return self.rng.choice(options)
