# Model selection rule (written before running the training-set comparison)

**Question.** Should the deployed proxy listener add the internal noise floor at the ISO 226 hearing threshold, or not?

**Why it is open.** On the CPC2 test set the floor-off configuration looked better (400-sentence subset). Choosing on those test labels would bias the reported numbers. CPC2 listeners set their own playback volume (dial 40 to 100), so the absolute presentation level that the floor depends on is uncertain.

**Rule.**
1. Data: a seeded random subset of 600 sentences from the CPC2 training split, track 1 (`cpc2_train/subset600.txt`, seed 20260928). No test labels are used. The sentences and scenes are disjoint from the test set. The 10 training listeners also appear among the 15 test listeners.
2. Model: Whisper base.en, the model the app deploys, with production settings otherwise (MSBG, −20 dB level offset for Clarity's 0 dBFS = 100 dB SPL convention, unclear below p = 0.4, better ear = max over ears).
3. Candidates: (A) floor on, corrected v2; (B) floor off.
4. Criterion: RMSE of the logistic-calibrated prediction under 5-fold listener-grouped cross-validation on the 600 training sentences. The lower RMSE wins. If the two are within 0.5 percentage points, keep (A), since it is the physically principled choice.
5. The chosen configuration is then reported on the full test set, with the other configuration shown alongside. Both test results are reported whichever wins.

Written 2026-09-28, before any training-set result was computed.
