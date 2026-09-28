import numpy as np
from scipy.signal import butter, sosfiltfilt

from app.sim import EQUIV_0DB_SPL, ISO226_F, ISO226_T, MSBG_FS, SPEECH_SPL, Listener, active_rms, internal_noise, set_spl, simulate


def _band_level_db(x: np.ndarray, fc: float) -> float:
    lo, hi = fc / 2 ** (1 / 6), fc * 2 ** (1 / 6)
    sos = butter(6, [lo, hi], btype="band", fs=MSBG_FS, output="sos")
    y = sosfiltfilt(sos, x)
    return 10 * np.log10(np.mean(y**2) + 1e-30) + EQUIV_0DB_SPL


def _speechlike(seconds: float = 2.0, seed: int = 0) -> np.ndarray:
    """Pink-ish noise with an on/off envelope, as a stand-in for speech."""
    rng = np.random.default_rng(seed)
    n = int(seconds * MSBG_FS)
    white = rng.standard_normal(n)
    spec = np.fft.rfft(white)
    f = np.fft.rfftfreq(n, 1 / MSBG_FS)
    spec /= np.sqrt(np.maximum(f, 50))
    x = np.fft.irfft(spec, n)
    env = (np.sin(2 * np.pi * 3 * np.arange(n) / MSBG_FS) > -0.3).astype(float)
    return x * env


def test_calibration_puts_active_speech_at_65_db_spl():
    x = set_spl(_speechlike(), MSBG_FS, SPEECH_SPL)
    level = 20 * np.log10(active_rms(x, MSBG_FS)) + EQUIV_0DB_SPL
    assert abs(level - SPEECH_SPL) < 0.5


def test_internal_noise_sits_at_the_iso_226_threshold():
    noise = internal_noise(4 * MSBG_FS)
    for fc in (500, 1000, 2000, 4000):
        expected = float(np.interp(fc, ISO226_F, ISO226_T))
        assert abs(_band_level_db(noise, fc) - expected) < 3, fc


def test_msbg_removes_more_high_frequency_energy_with_more_loss():
    x = _speechlike(seed=1)
    mild = simulate(x, MSBG_FS, Listener(left=[10] * 7, right=[10] * 7), ears=("right",)).ears["right"]
    sloping = simulate(x, MSBG_FS, Listener(left=[20, 25, 35, 50, 60, 70, 75], right=[20, 25, 35, 50, 60, 70, 75]), ears=("right",)).ears["right"]
    assert _band_level_db(sloping, 4000) < _band_level_db(mild, 4000) - 20
    assert abs(_band_level_db(sloping, 500) - _band_level_db(mild, 500)) < 15
