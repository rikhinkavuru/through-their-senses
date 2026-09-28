from app.text import align, normalize_words, words_correct


def test_numbers_and_punctuation_normalize():
    assert normalize_words("I'll pick you up at 15 past 6.") == ["i'll", "pick", "you", "up", "at", "fifteen", "past", "six"]
    assert normalize_words("The 3rd of May, 6:30") == ["the", "third", "of", "may", "six", "thirty"]


def test_alignment_marks_substitutions_and_deletions():
    ref = "your pills are on the shelf".split()
    hyp = "your poles are the shelf".split()
    pairs = align(ref, hyp)
    assert ("pills", "poles") in pairs
    assert ("on", None) in pairs
    assert words_correct(ref, hyp) == 4
