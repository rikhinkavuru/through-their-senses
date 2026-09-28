# Through Their Senses

See the room and hear your own voice the way someone with glaucoma and hearing loss does, built from their real visual field test and audiogram. Then plan together what to change at home and how to talk with each other.

**Live:** https://through-their-senses.vercel.app · **Try the example:** https://through-their-senses.vercel.app/p/example · **How it works:** https://through-their-senses.vercel.app/method

Built for [UnivaBio 2026](https://univabio.devpost.com) (AI for Human Health).

## Why

- Public images of glaucoma show a black tunnel. When 50 patients compared pictures with their own sight, none chose it; they chose blurred or missing patches (Crabb et al., 2013). Families are learning the wrong picture.
- Hearing loss is the largest modifiable risk factor for dementia (Lancet Commission, 2020), and vision and hearing loss often arrive together in later life.
- Families carry this too ("third-party disability"): they become the person’s ears and eyes without being shown how.

Disability simulations can backfire when shown alone, making people rate disabled people as less capable (Silverman et al., 2015). So every screen pairs the simulation with what still works and how people adapt, uses real patients’ words, and the person it’s about co-owns the plan.

## What it does

| Screen | What happens |
|---|---|
| **See** | The camera (or a sample room) through their visual field: detail and contrast fade where their field is weaker, and objects disappear into their surroundings where it’s weakest. Drag to compare with your view; scrub through years of tests; dim-light mode. |
| **Hear** | Say a sentence. It plays through a model of their hearing; a speech recogniser listening through that model shows what they probably heard (in a quiet room, “I’ll pick you up at fifteen past six on Thursday” becomes “I’ll pick you up at *fifty* and have six on Thursday”). Letters fade by how audible each sound is. Quiet room or dinner table, with or without hearing aids. |
| **Say it better** | Claude writes rewordings; each is spoken by one synthetic voice and scored by the same hearing model, and only the ones that come through better are shown. |
| **Walk** | Aim the phone where they’d look while walking. An on-device depth model finds step edges; each edge’s contrast is compared with what their vision needs at that spot. Try a contrasting strip and see the verdict change; they decide what to do. |
| **Sit** | Where to sit at the table so they can hear you and see your face: better-ear side, face in their clear field, not backlit. |
| **Guide** | One printable page built from all of it, which they can edit before anyone sees it. |

## How it’s built

```
web/        Next.js 16 app (Vercel). WebGL2 renderer, Transformers.js depth in a worker.
hearing/    FastAPI on Vercel Python: Cambridge MSBG hearing loss simulator + Whisper proxy listener.
tts/        FastAPI on Vercel Python: Kokoro TTS for scoring rewordings in one consistent voice.
data/       Scripts that build the visual field and audiogram libraries.
validation/ CPC2 validation of the proxy listener.
docs/       Design spec (VISION.md).
```

**Vision.** Visual fields from the UWHVF dataset (28,943 real tests) or typed from a Humphrey 24-2 printout. Both eyes merge with the best-location rule; a pointwise trend smooths test noise. The renderer implements Peli’s band-limited contrast model on the GPU: a Laplacian pyramid of each frame in linear light, local band contrast, and removal of contrast below the person’s threshold, where total deviation TD raises a normal contrast sensitivity threshold by 10^(−TD/10).

**Hearing.** Speech is calibrated to 65 dB SPL, optionally mixed with eight-talker babble and NAL-R hearing-aid gain, then run through MSBG per ear. A noise floor at the ISO 226 hearing threshold stops the recogniser from hearing sounds no person could. Whisper listens with each ear and the better ear wins. Results stream back in stages so the first appears in about two seconds.

**Validation.** On the Clarity Prediction Challenge 2 evaluation set (897 sentences, 15 listeners with hearing loss), the proxy listener predicts how many words real listeners repeated correctly:
- With Whisper small.en: RMSE 26.9, r 0.74, significantly better than HASPI, the standard intelligibility index (28.6, 0.70).
- The deployed base.en: 27.7, 0.72, better than HASPI on average but within the margin of error.

The noise-floor setting was chosen on training sentences by a pre-registered rule ([validation/SELECTION.md](validation/SELECTION.md)). See [validation/RESULTS.md](validation/RESULTS.md).

## Run locally

```bash
# hearing service
cd hearing && uv sync && uv run uvicorn app.main:app --port 8765
# tts service (models: kokoro-v1.0.int8.onnx and voices-v1.0.bin in tts/models)
cd tts && uv sync && uv run uvicorn app.main:app --port 8766
# web
cd web && npm install && npm run dev
```

`web/.env.local`: `HEARING_URL`, `TTS_URL`, and (for rewording) Vercel AI Gateway credentials. Rebuild the data with `data/scripts/build_fields.py` and `build_audiograms.py` (raw data downloads are described at the top of each script).

## Tests

- `cd web && npm test`: field layout and binocular merge, interpolation, contrast sensitivity and the TD threshold rule, hazard verdicts, and the step finder on a synthetic staircase.
- `cd web && npm run test:gpu` (with `npm run dev` running): the WebGL renderer in headless Chromium. Typical vision renders unchanged, contrast falls monotonically with loss, deep loss removes fine detail, and mean brightness is preserved.
- `cd web && npm run test:a11y`: axe-core WCAG 2.2 AA audit of every page (currently zero violations).
- `cd hearing && uv run pytest`: text normalisation and alignment, letter-to-sound alignment, 65 dB SPL calibration, the ISO 226 noise floor, and MSBG attenuation.

## Honest limits

The vision view is exact only while you look at the cross. The 24-2 test covers only the central 24–30 degrees. The proxy listener is validated on CPC2 listeners, not on the person in the profile, and speech recognisers do worse than people in heavy noise. Dim-light effects are approximations. It does not diagnose anything. Full list on the [How it works](https://through-their-senses.vercel.app/method) page.

## Credits

UWHVF (BSD-3-Clause) · NHANES 2017–2018 audiometry (public domain) · CPC2 (CC BY-SA 4.0) · Glen & Crabb 2015 quotes (CC BY 4.0) · pyClarity MSBG and NAL-R (MIT) · faster-whisper (MIT) · Kokoro-82M (Apache-2.0) · Depth Anything V2 Small (Apache-2.0) · Atkinson Hyperlegible Next (OFL) · photos from Wikimedia Commons (CC0 / CC BY-SA 4.0, credited in the app).
