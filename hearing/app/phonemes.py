"""Explanatory audibility model: which speech sounds fall below her thresholds.

This is the explanation layer behind the fading letters, not the prediction. The
prediction comes from the proxy listener (MSBG + Whisper). Each phoneme gets a
dominant frequency and a typical level (dB HL) for conversational speech at about
1 metre, following the widely published "familiar sounds" audiogram / speech banana
placement (Northern and Downs). Audibility uses the Speech Intelligibility Index
convention that speech spans roughly 30 dB, from 15 dB above to 15 dB below its
typical level (ANSI S3.5-1997).
"""

from __future__ import annotations

from functools import lru_cache

import numpy as np

AUDIOGRAM_FREQS = np.array([500, 1000, 2000, 3000, 4000, 6000, 8000])

# ARPAbet phoneme -> (dominant frequency Hz, typical level dB HL at ~1 m).
PHONEME_BANANA: dict[str, tuple[float, float]] = {
    # vowels: energy in the first two formants, the loudest speech sounds
    "AA": (800, 55), "AE": (1000, 52), "AH": (700, 52), "AO": (700, 55), "AW": (800, 52),
    "AY": (900, 52), "EH": (1100, 50), "ER": (1300, 48), "EY": (1500, 48), "IH": (1500, 45),
    "IY": (2000, 42), "OW": (600, 52), "OY": (800, 50), "UH": (800, 48), "UW": (500, 48),
    # nasals and liquids: low frequency, fairly strong
    "M": (300, 45), "N": (400, 43), "NG": (400, 40), "L": (500, 45), "R": (1000, 45),
    "W": (500, 45), "Y": (2000, 40), "HH": (1500, 25),
    # voiced stops and fricatives
    "B": (500, 38), "D": (1500, 35), "G": (1500, 35), "V": (2500, 25), "DH": (3000, 20),
    "Z": (4000, 25), "ZH": (3000, 32), "JH": (2500, 35),
    # voiceless: the quiet, high-pitched consonants that carry meaning
    "P": (2000, 30), "T": (3000, 30), "K": (2500, 32), "CH": (2500, 35), "SH": (3000, 35),
    "S": (5000, 25), "F": (5000, 15), "TH": (5000, 12),
}

# Approximate long-term speech spectrum in dB HL at 1 m (for the babble level).
LTASS_HL = {500: 45, 1000: 40, 2000: 32, 3000: 28, 4000: 25, 6000: 20, 8000: 18}

# NAL-R prescription constants k(f) (Byrne and Dillon 1986).
NALR_K = {500: -8, 1000: 1, 2000: -1, 3000: -2, 4000: -2, 6000: -2, 8000: -2}


@lru_cache(maxsize=1)
def _cmu() -> dict[str, list[list[str]]]:
    import cmudict

    return cmudict.dict()


def phonemes(word: str) -> list[str]:
    prons = _cmu().get(word.lower())
    if prons:
        return [p.rstrip("012") for p in prons[0]]
    # Out-of-vocabulary fallback: crude letter-to-sound for display only.
    table = {"a": "AE", "e": "EH", "i": "IH", "o": "AA", "u": "AH", "y": "IY", "c": "K", "q": "K", "x": "K",
             "j": "JH", "b": "B", "d": "D", "f": "F", "g": "G", "h": "HH", "k": "K", "l": "L", "m": "M",
             "n": "N", "p": "P", "r": "R", "s": "S", "t": "T", "v": "V", "w": "W", "z": "Z"}
    return [table[c] for c in word.lower() if c in table]


def _interp_threshold(thresholds: list[float], f: float) -> float:
    return float(np.interp(np.log(f), np.log(AUDIOGRAM_FREQS), thresholds))


def nalr_gain_db(thresholds: list[float], f: float) -> float:
    t = dict(zip(AUDIOGRAM_FREQS.tolist(), thresholds))
    x = 0.05 * (t[500] + t[1000] + t[2000])
    ks = np.interp(np.log(f), np.log(AUDIOGRAM_FREQS), [NALR_K[int(q)] for q in AUDIOGRAM_FREQS])
    return max(0.0, x + 0.31 * _interp_threshold(thresholds, f) + float(ks))


def phoneme_audibility(ph: str, thresholds: list[float], snr_db: float | None, aided: bool) -> float:
    f, level = PHONEME_BANANA.get(ph, (1000, 40))
    if aided:
        level += nalr_gain_db(thresholds, f)
    floor = _interp_threshold(thresholds, f)
    if snr_db is not None:
        noise = float(np.interp(np.log(f), np.log(list(LTASS_HL)), list(LTASS_HL.values()))) - snr_db
        if aided:
            noise += nalr_gain_db(thresholds, f)
        floor = max(floor, noise)
    return float(np.clip((level - floor + 15) / 30, 0, 1))


VOWEL_PH = {"AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW"}
LETTER_PH = {
    "b": {"B"}, "c": {"K", "S", "CH"}, "d": {"D", "JH"}, "f": {"F"}, "g": {"G", "JH", "ZH"},
    "h": {"HH", "SH", "TH", "DH", "CH"}, "j": {"JH"}, "k": {"K"}, "l": {"L"}, "m": {"M"}, "n": {"N", "NG"},
    "p": {"P", "F"}, "q": {"K"}, "r": {"R", "ER"}, "s": {"S", "Z", "SH", "ZH"}, "t": {"T", "TH", "DH", "CH", "SH"},
    "v": {"V"}, "w": {"W"}, "x": {"K", "S", "Z"}, "z": {"Z", "S"},
}


def _compat(letter: str, ph: str) -> float:
    if letter in "aeiou":
        return 2.0 if ph in VOWEL_PH else (0.5 if ph in {"Y", "W", "R"} else -1.0)
    if letter == "y":
        return 2.0 if ph in {"Y", "IY", "IH", "AY"} else (1.0 if ph in VOWEL_PH else -1.0)
    if letter in LETTER_PH:
        return 2.0 if ph in LETTER_PH[letter] else (-1.0 if ph in VOWEL_PH else -0.5)
    return 0.0


def align_letters(letters: str, phs: list[str]) -> list[list[int]]:
    """Monotonic letter-to-phoneme alignment (Viterbi).

    Every letter maps to one phoneme; neighbouring letters may share a phoneme
    (silent or doubled letters), and a letter may also absorb the next phoneme
    ("x" = K S). Returns, per letter, the phoneme indices it covers.
    """
    n, m = len(letters), len(phs)
    if n == 0 or m == 0:
        return [[] for _ in letters]
    neg = -1e9
    score = [[neg] * m for _ in range(n)]
    back: list[list[tuple[int, bool] | None]] = [[None] * m for _ in range(n)]
    score[0][0] = _compat(letters[0], phs[0])
    if m > 1:
        score[0][1] = max(_compat(letters[0], phs[0]), _compat(letters[0], phs[1])) - 0.5
        back[0][1] = (-1, True)
    for i in range(1, n):
        for j in range(m):
            best, arg = neg, None
            for dj, absorbed in ((0, False), (1, False), (2, True)):
                pj = j - dj
                if pj < 0 or score[i - 1][pj] == neg:
                    continue
                # "x" and "q" really do spell two sounds; other letters rarely do.
                absorb_cost = 0.1 if letters[i] in "xq" else 0.8
                c = score[i - 1][pj] + (_compat(letters[i], phs[j]) if not absorbed else max(_compat(letters[i], phs[j]), _compat(letters[i], phs[j - 1])) - absorb_cost)
                if dj == 0:
                    c -= 0.3  # sharing a phoneme is allowed but slightly discouraged
                if c > best:
                    best, arg = c, (pj, absorbed)
            score[i][j] = best
            back[i][j] = arg
    j = m - 1
    cover: list[list[int]] = [[] for _ in range(n)]
    for i in range(n - 1, -1, -1):
        b = back[i][j]
        cover[i] = [j - 1, j] if b and b[1] else [j]
        if b is None:
            break
        j = b[0]
    return [c if c and c[0] >= 0 else [max(0, c[-1])] if c else [0] for c in cover]


def word_audibility(word: str, thresholds: list[float], snr_db: float | None, aided: bool) -> dict:
    """Per-letter audibility for display. Letters are aligned to phonemes by spelling."""
    phs = phonemes(word)
    if not phs:
        return dict(word=word, phonemes=[], letters=[1.0] * len(word), score=1.0)
    a = [phoneme_audibility(p, thresholds, snr_db, aided) for p in phs]
    alpha_idx = [i for i, c in enumerate(word) if c.isalpha()]
    cover = align_letters("".join(word[i].lower() for i in alpha_idx), phs)
    per_letter = [1.0] * len(word)
    for k, idx in enumerate(alpha_idx):
        per_letter[idx] = round(min(a[j] for j in cover[k]), 2)
    return dict(
        word=word,
        phonemes=[dict(p=p, a=round(x, 2), f=PHONEME_BANANA.get(p, (1000, 40))[0]) for p, x in zip(phs, a)],
        letters=per_letter,
        score=round(float(np.mean(a)), 2),
    )
