from app.phonemes import align_letters, phoneme_audibility, phonemes, word_audibility

NORMAL = [0, 0, 0, 0, 0, 0, 0]
SLOPING = [20, 25, 35, 50, 60, 70, 75]


def test_letter_alignment_follows_spelling():
    ph = phonemes("six")
    cover = align_letters("six", ph)
    assert [[ph[j] for j in c] for c in cover] == [["S"], ["IH"], ["K", "S"]]
    ph = phonemes("fifteen")
    cover = align_letters("fifteen", ph)
    assert [ph[c[0]] for c in cover] == ["F", "IH", "F", "T", "IY", "IY", "N"]


def test_high_quiet_consonants_fade_first_with_sloping_loss():
    assert phoneme_audibility("S", NORMAL, None, False) == 1.0
    assert phoneme_audibility("S", SLOPING, None, False) < 0.2
    assert phoneme_audibility("AA", SLOPING, None, False) > 0.9


def test_noise_and_aids_move_audibility_in_the_right_direction():
    quiet = phoneme_audibility("T", SLOPING, None, False)
    noisy = phoneme_audibility("T", SLOPING, 5, False)
    aided = phoneme_audibility("T", SLOPING, None, True)
    assert noisy <= quiet
    assert aided > quiet


def test_word_audibility_has_one_value_per_letter():
    w = word_audibility("fifteen", SLOPING, None, False)
    assert len(w["letters"]) == len("fifteen")
    assert w["letters"][0] < w["letters"][1]  # "f" is fainter than "i"
