# Submission package (UnivaBio 2026)

Everything to paste into Devpost, plus the demo video script. Numbers come from validation/results.json. Written as "we": change to "I" if you are entering solo.

---

## Devpost fields

**Project name:** Through Their Senses

**Tagline (≤200 characters):** See the room and hear your own voice the way someone with glaucoma and hearing loss does, from their real test results, then plan together what to change.

**Try it out:** https://through-their-senses.vercel.app · Example: https://through-their-senses.vercel.app/p/example · Method and validation: https://through-their-senses.vercel.app/method

**Built with:** next.js, react, typescript, webgl, tailwindcss, python, fastapi, whisper, ctranslate2, transformers.js, depth-anything, kokoro, claude, vercel, ai-sdk

### Inspiration

Almost every public image of glaucoma shows a black tunnel closing in. When researchers asked 50 people with glaucoma which picture looked like their own sight, not one chose it. They chose blurred or missing patches, and a quarter hadn’t noticed their loss at all (Crabb et al., 2013). The people around them are learning the wrong picture.

Hearing loss has the opposite problem: it’s invisible. It is the largest modifiable risk factor for dementia, it often arrives alongside vision loss, and families end up acting as someone’s ears without anyone showing them how. One woman with glaucoma put it simply: people are “very helpful on the eyesight side. They’re not so helpful on the hearing side.”

We wanted a family to understand one specific person, from that person’s own tests, and then do something useful with it.

### What it does

You load a visual field test (photographed or typed from the Humphrey printout, or a close match from 28,943 real anonymized tests) and an audiogram, or test their hearing in the app with headphones. Then:

- **See.** The phone camera, or a sample room, rendered through their field. Detail and contrast fade where their vision is weaker; where it is weakest, objects disappear into the colour around them, the way patients describe it. Drag a divider to compare with your own view, scrub through years of their tests, and switch to evening lamps or TV light with glare. On a laptop, the view can follow your eyes through the webcam.
- **Hear.** Say a sentence. It plays through a model of their hearing, and a speech recogniser listening through that model shows what they probably heard. In a quiet room, “I’ll pick you up at fifteen past six on Thursday” becomes “I’ll pick you up at *fifty* and have six on Thursday”; at a busy table she loses half the sentence while someone with typical hearing keeps most of it. Letters fade by how audible each sound is. Toggle hearing aids. Play it back through their ears.
- **Say it better.** Claude writes rewordings; each one, and the original, is spoken by the same synthetic voice and scored by the same hearing model, so only rewordings that really come through better are shown.
- **Walk it together.** Aim the phone where they’d look while walking. A depth model running on the phone finds step edges; for each, we measure its contrast and compare it with what their vision needs at that exact spot. Edges in the lower field, where loss is linked to falls, come first. Try a contrasting strip and watch the verdict change. They decide what gets done.
- **Sit.** Where to sit at the table so they hear you with their better ear and see your face in the clear part of their vision, without the window behind you.
- **Guide.** One printable page built from everything, starting with what already works, which they can edit before anyone else sees it.

Research shows disability simulations can backfire, making people see disabled people as less capable. So every simulation screen pairs the picture with what still works and how people adapt, real patients’ words appear throughout, and the person it’s about co-owns the plan.

### How we built it

- **Vision.** Visual fields come from the University of Washington UWHVF dataset. We merge both eyes with the best-location rule (the better eye wins at each point) and fit a trend across visits. The renderer implements Peli’s band-limited contrast model in WebGL2. Each frame becomes a Laplacian pyramid in linear light. At every pixel and scale we compute local contrast and remove whatever falls below that person’s threshold there. A total deviation of TD dB raises a normal contrast sensitivity threshold by 10^(−TD/10), straight from how perimetry dB is defined. Dim light uses eye-level light measured in real homes (Miller and Kinzey 2018), Barten’s contrast sensitivity model, glaucoma’s diffuse loss deepening in dim light (Drum et al. 1986), and a glare veil computed per texel from the CIE 146:2002 disability glare formula at the person’s age. Follow-my-eyes uses MediaPipe Face Landmarker on-device, ridge regression from a 13-dot calibration and a One Euro filter; it measures its own held-out accuracy and only follows under 7°.
- **Hearing.** A Python service calibrates speech to 65 dB SPL, adds eight-talker babble and NAL-R hearing-aid gain when asked, and runs the Cambridge MSBG hearing loss simulator per ear. Whisper then acts as a "proxy listener". Speech recognisers pick up sounds far below any human threshold, so we first add a noise floor at the ISO 226 hearing threshold. Each ear is transcribed and the better ear wins. Results stream in stages: what was said arrives in about 2 seconds, then what they likely heard.
- **Walk.** Depth Anything V2 runs on-device in a Web Worker via Transformers.js. We find step edges as depth discontinuities measured against the local floor ramp, keep only those between two flat treads, and judge each one with the same threshold model the renderer uses.
- **Hearing test.** Browsers can’t know how loud headphones are, so a helper with typical hearing takes the same beep test first on the same headphones. The difference, plus the ISO 7029:2017 median loss for the helper’s age, is the person’s audiogram (biological calibration, after Masalski et al. 2014). The search is modified Hughson-Westlake with catch trials and a 1 kHz retest.
- **Printout photo.** Claude Sonnet reads the Total Deviation plot as 10 column slots per row; the server checks each row against the known 24-2 layout for that eye and repairs a one-slot shift or a dropped blind-spot blank. The person checks every number before it’s used.
- **Infrastructure.** Next.js 16 on Vercel; two FastAPI services on Vercel's Python runtime. We vendored MSBG and faster-whisper to fit a 500 MB function limit, and rewording uses Claude through the AI SDK.

### How we checked it

We tested the proxy listener on the Clarity Prediction Challenge 2 evaluation set: 897 sentences heard by 15 listeners with hearing loss, with their audiograms and what they actually repeated back.
- With Whisper small.en, the calibrated proxy listener predicted how many words each person got right with RMSE 26.9 and correlation 0.74. HASPI, the standard intelligibility index, scored 28.6 and 0.70 on the same sentences. The improvement is statistically clear: the paired RMSE difference is −1.7, 95% CI −3.3 to −0.2.
- The deployed app runs the smaller base.en to fit free hosting. It scores 27.7 and 0.72: better than HASPI on average, but within the margin of error.
- The best published systems, trained on CPC2 training data, reach 25.1 and 0.78. Ours uses no training beyond a two-number calibration with listener-grouped cross-validation.
- One design choice, whether to add a noise floor at the human hearing threshold, was decided on separate training sentences by a rule we committed before running it. We report the setting we didn't choose too, because on the test set it would have scored better. Full details are in validation/RESULTS.md.

The newer parts were each checked against something we couldn't tune on:
- **Step edges.** The rule was chosen on 32 Wikimedia Commons photos and then run once on 47 others, labelled beforehand. False edges in rooms without steps fell from 2.72 to 0.56 per photo; stairs found fell from 21 to 19 of 22.
- **Printout photo.** No real printout is openly licensed, so we drew 54 Humphrey-style printouts from real UWHVF fields (with a Pattern Deviation plot as a decoy) and photographed them in simulation: tilt, rotation, uneven light, blur, noise, JPEG. Over 3 reads of each, 96.0% of numbers were exact, 0.7% wrong and 3.3% left blank for the person to type; median 3.6 s. Before we gave the model the layout and added the check, left eyes came back shifted by a column and only 76.7% of numbers were exact.
- **Glare.** The rendered veil matches the CIE 146 equation within 7% at 3°, 6° and 10° for both ages, on the GPU.
- **Hearing test.** Simulated listeners with a known audiogram, run through the full app flow, came out within 5 dB of the truth at every pitch.
- **Follow-my-eyes.** Checked end to end with a recorded face in a test browser only; accuracy on real webcams is measured by the app each time, and we haven't yet collected it across people.

### Challenges we ran into

- **Recognisers hear too well, or do they?** Speech recognisers pick up sounds far quieter than any person can, so we added a noise floor at the human hearing threshold. A unit test then showed our first floor was 7 to 9 dB too high, and after fixing it the validation surprised us: on CPC2 the floor did not improve predictions, most likely because CPC2 listeners set their own playback volume. We wrote down a rule for choosing on the separate training set before running it (validation/SELECTION.md) rather than picking whatever scored best on the test set. On training data the difference was within the tie margin, so the floor stayed, and we report the test result for the setting we didn't choose.
- **Step edges seen at an angle.** Treads viewed from the side run diagonally, and averaging depth over wide bands smeared them out. Narrower bands and measuring each jump against the local floor ramp found them.
- **The 500 MB limit.** The hearing service was 1.3 GB. We vendored the simulator, dropped audio-decoding and VAD dependencies we never call, and split speech synthesis into its own service.
- **Representation.** Getting the framing right took as much work as the maths. We read the research on why disability simulations backfire and redesigned around it.

### Accomplishments that we’re proud of

- A glaucoma renderer grounded in published perception research, from real patients' tests, running live on a phone camera.
- A hearing model that predicts what real listeners with hearing loss understand better than the standard intelligibility index (significantly with Whisper small.en; on average with the smaller model the app deploys).
- Every number in the app traces to a source, and untested regions are shown as untested.

### What we learned

Accuracy and dignity are the same problem. The black tunnel is both wrong and harmful, and the fix for both was to model what people actually experience and put it next to what they still do well.

### What’s next

- Measure follow-my-eyes accuracy across real webcams and people.
- A digits-in-noise test as a second check on the in-app hearing test.
- Test printout reading on real printouts, with permission from patients.
- Usability sessions with older adults and their families, and reviews by an optometrist, audiologist and occupational therapist.

### Working vs planned

| Feature | Status |
|---|---|
| See (field renderer, years slider, dim light and glare) | Working; lamp brightness, eye colour and wall reflectance are assumed |
| Hear (MSBG + proxy listener, noise, hearing aids, playback) | Working, validated on CPC2 |
| Say it better (Claude + scoring) | Working |
| Walk (on-device step edges and verdicts) | Working; 0.56 false edges per room without steps, misses some stairs (19 of 22 found) |
| Sit, Guide, setup with printout entry | Working |
| Printout photo | Working; checked on synthetic printouts, the person verifies every number |
| Hearing test in the app (paired tone test) | Working; an estimate, about ±10 dB |
| Follow-my-eyes (laptop webcam) | Working; checked with a recorded face, not yet across real webcams |
| Digits-in-noise test | Not built |

---

## Demo video script (under 3 minutes)

Record the screen at 1920×1080 on a laptop (Chrome, GPU on), with your own voice. Captions burned in. Upload to YouTube as unlisted, **not** “made for kids”.

| Time | Screen (URL) | Voiceover |
|---|---|---|
| 0:00–0:08 | `docs/gallery/0-usual-black-tunnel.png` (the usual depiction, made from the same hallway photo), then cut to `/p/example/see?scene=hallway&wipe=0.5` | “This is how glaucoma is usually shown. When 50 patients were asked, not one said it looks like this.” |
| 0:08–0:18 | Same screen, drag the divider slowly left to right | “This is closer: their own test results, applied to a real room. Things don’t go black. They fade, and then they disappear into what’s around them.” |
| 0:18–0:32 | `/` landing, then Try the example → About page | “Through Their Senses starts from one person’s real visual field test and hearing test. This is Meera, an example built from two real anonymized records. We start with what still works.” |
| 0:32–0:55 | Back to See: scrub the age slider from 61 to 71, set the light to TV light only | “Ten years of her tests. And at night, with a lamp in view, it gets harder. Everything here is exact while you keep your eyes on the cross, the way the test is done.” |
| 0:55–1:30 | `/p/example/hear`, Quiet room, tap the “fifteen past six” sample (or say it yourself); let the stages appear; then switch to Dinner table; press Play as she hears it (headphones) | “Now her hearing. I say: I’ll pick you up at fifteen past six on Thursday. Even in a quiet room, she hears: fifty. The faded letters are the sounds she can’t catch: f, s, t, th. At a dinner table, she loses half the sentence, while someone with typical hearing keeps most of it.” |
| 1:30–1:45 | Tap Help me say it more clearly | “Claude suggests other ways to say it, and every suggestion is checked against her hearing model before we show it.” |
| 1:45–2:15 | `/p/example/walk`, Stairs, Check this spot; tap card 1, Try a contrasting strip; Yes, she wants it | “Walking the house together. The phone finds the step edges, measures their contrast, and compares it with what her vision needs at that spot. These treads are hidden from her. She decides what to change.” |
| 2:15–2:30 | `/p/example/sit`, then `/p/example/guide` | “Where to sit so she hears your voice and sees your face. And everything becomes one page she can edit and share.” |
| 2:30–2:50 | `/method`, scroll to the validation table | “We tested the hearing model on real listeners with hearing loss from the Clarity challenge. It predicts what they understood better than the standard index. And every newer part is checked on data we didn’t tune on.” |
| 2:50–3:00 | Back to the See split view | “Not a tunnel. Her.” |

Tips: pre-load each page once (the depth model and hearing service warm up), keep the browser zoom at 100%, and do one silent run before recording.

---

## One-page PDF

Generated from `docs/ONE_PAGER.md` (see that file).
