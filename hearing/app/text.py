"""Text normalization and word alignment between what was said and what she heard."""

from __future__ import annotations

import re

from num2words import num2words

_PUNCT = re.compile(r"[^\w\s']")


def _num(tok: str) -> str:
    m = re.fullmatch(r"(\d+)(st|nd|rd|th)?", tok)
    if not m:
        return tok
    n = int(m.group(1))
    words = num2words(n, to="ordinal") if m.group(2) else num2words(n)
    return words.replace("-", " ").replace(",", "")


def normalize_words(text: str) -> list[str]:
    text = text.replace("%", " percent").replace("&", " and ")
    text = re.sub(r"(\d):(\d\d)", lambda m: f"{m.group(1)} {m.group(2)}", text)
    out: list[str] = []
    for tok in _PUNCT.sub(" ", text.lower()).split():
        out.extend(_num(tok).split())
    return [w.strip("'") for w in out if w.strip("'")]


def align(ref: list[str], hyp: list[str]) -> list[tuple[str | None, str | None]]:
    """Levenshtein alignment. Returns (ref_word, hyp_word) pairs; None marks a gap."""
    n, m = len(ref), len(hyp)
    d = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        d[i][0] = i
    for j in range(m + 1):
        d[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            cost = 0 if ref[i - 1] == hyp[j - 1] else 1
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
    pairs: list[tuple[str | None, str | None]] = []
    i, j = n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0 and d[i][j] == d[i - 1][j - 1] + (0 if ref[i - 1] == hyp[j - 1] else 1):
            pairs.append((ref[i - 1], hyp[j - 1]))
            i, j = i - 1, j - 1
        elif i > 0 and d[i][j] == d[i - 1][j] + 1:
            pairs.append((ref[i - 1], None))
            i -= 1
        else:
            pairs.append((None, hyp[j - 1]))
            j -= 1
    return pairs[::-1]


def words_correct(ref: list[str], hyp: list[str]) -> int:
    return sum(1 for r, h in align(ref, hyp) if r is not None and r == h)


def _similar(a: str, b: str) -> float:
    from difflib import SequenceMatcher

    return SequenceMatcher(None, a, b).ratio()


def align_for_display(ref: list[str], hyp: list[str]) -> list[tuple[str | None, str | None]]:
    """Alignment for showing what was heard: substitutions between similar-sounding
    spellings (fifteen / fifty) are cheaper, so the pairing reads naturally.

    Display only. Word counting uses align(), which the validation also uses.
    """
    n, m = len(ref), len(hyp)
    d = [[0.0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        d[i][0] = float(i)
    for j in range(m + 1):
        d[0][j] = float(j)

    def sub(a: str, b: str) -> float:
        return 0.0 if a == b else 1.0 - 0.6 * _similar(a, b)

    for i in range(1, n + 1):
        for j in range(1, m + 1):
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + sub(ref[i - 1], hyp[j - 1]))
    pairs: list[tuple[str | None, str | None]] = []
    i, j = n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0 and abs(d[i][j] - (d[i - 1][j - 1] + sub(ref[i - 1], hyp[j - 1]))) < 1e-9:
            pairs.append((ref[i - 1], hyp[j - 1]))
            i, j = i - 1, j - 1
        elif i > 0 and abs(d[i][j] - (d[i - 1][j] + 1)) < 1e-9:
            pairs.append((ref[i - 1], None))
            i -= 1
        else:
            pairs.append((None, hyp[j - 1]))
            j -= 1
    return pairs[::-1]
