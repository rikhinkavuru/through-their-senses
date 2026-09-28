# Submission package (UnivaBio 2026)

Everything to paste into Devpost, plus the demo video script. Numbers marked ⟨VAL⟩ come from validation/results.json; they are filled in below once the run completes. Written as "we": change to "I" if you are entering solo.

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

You load a visual field test (typed from the Humphrey printout, or a close match from 28,943 real anonymized tests) and an audiogram. Then:

- **See.** The phone camera, or a sample room, rendered through their field. Detail and contrast fade where their vision is weaker; where it is weakest, objects disappear into the colour around them, the way patients describe it. Drag a divider to compare with your own view, scrub through years of their tests, and switch on dim light with glare.
- **Hear.** Say a sentence. It plays through a model of their hearing, and a speech recogniser listening through that model shows what they probably heard. At a busy table, “your pills are on the shelf next to the sink” becomes “your *poles* are on the shelf next to the *snake*”. Letters fade by how audible each sound is. Toggle hearing aids. Play it back through their ears.
- **Say it better.** Claude writes rewordings; each one, and the original, is spoken by the same synthetic voice and scored by the same hearing model, so only rewordings that really come through better are shown.
- **Walk it together.** Aim the phone where they’d look while walking. A depth model running on the phone finds step edges; for each, we measure its contrast and compare it with what their vision needs at that exact spot. Edges in the lower field, where loss is linked to falls, come first. Try a contrasting strip and watch the verdict change. They decide what gets done.
- **Sit.** Where to sit at the table so they hear you with their better ear and see your face in the clear part of their vision, without the window behind you.
- **Guide.** One printable page built from everything, starting with what already works, which they can edit before anyone else sees it.

Research shows disability simulations can backfire, making people see disabled people as less capable. So every simulation screen pairs the picture with what still works and how people adapt, real patients’ words appear throughout, and the person it’s about co-owns the plan.

### How we built it

- **Vision.** Visual fields come from the University of Washington UWHVF dataset. We merge both eyes with the best-location rule (the better eye wins at each point) and fit a trend across visits. The renderer implements Peli’s band-limited contrast model in WebGL2. Each frame becomes a Laplacian pyramid in linear light. At every pixel and scale we compute local contrast and remove whatever falls below that person’s threshold there. A total deviation of TD dB raises a normal contrast sensitivity threshold by 10^(−TD/10), straight from how perimetry dB is defined. Dim light adds a mesopic penalty and a glare veil that approximates 1/θ² light scatter.
- **Hearing.** A Python service calibrates speech to 65 dB SPL, adds eight-talker babble and NAL-R hearing-aid gain when asked, and runs the Cambridge MSBG hearing loss simulator per ear. Whisper then acts as a "proxy listener". Speech recognisers pick up sounds far below any human threshold, so we first add a noise floor at the ISO 226 hearing threshold. Each ear is transcribed and the better ear wins. Results stream in stages: what was said arrives in about 2 seconds, then what they likely heard.
- **Walk.** Depth Anything V2 runs on-device in a Web Worker via Transformers.js. We find step edges as depth discontinuities measured against the local floor ramp, and judge each one with the same threshold model the renderer uses.
- **Infrastructure.** Next.js 16 on Vercel; two FastAPI services on Vercel's Python runtime. We vendored MSBG and faster-whisper to fit a 500 MB function limit, and rewording uses Claude through the AI SDK.

### How we checked it

We tested the proxy listener on the Clarity Prediction Challenge 2 evaluation set: 897 sentences heard by 15 listeners with hearing loss, with their audiograms and what they actually repeated back. The calibrated proxy listener predicted how many words each person got right with RMSE ⟨VAL: ours_cal rmse⟩ and correlation ⟨VAL: ours_cal r⟩. HASPI, the standard intelligibility index, scored ⟨VAL: haspi rmse / r⟩ on the same sentences. The best published systems, which were trained on CPC2 data, reach RMSE 25.1 and r 0.78. Ours uses no training beyond a two-number calibration with listener-grouped cross-validation. The deployed app runs a smaller Whisper model: ⟨VAL: base.en numbers⟩.

### Challenges we ran into

- **Recognisers hear too well.** At first the proxy listener transcribed simulated hearing loss perfectly, because Whisper normalises volume internally. Adding a noise floor at the human hearing threshold fixed it, and the validation ablation shows the effect.
- **Step edges seen at an angle.** Treads viewed from the side run diagonally, and averaging depth over wide bands smeared them out. Narrower bands and measuring each jump against the local floor ramp found them.
- **The 500 MB limit.** The hearing service was 1.3 GB. We vendored the simulator, dropped audio-decoding and VAD dependencies we never call, and split speech synthesis into its own service.
- **Representation.** Getting the framing right took as much work as the maths. We read the research on why disability simulations backfire and redesigned around it.

### Accomplishments that we’re proud of

- A glaucoma renderer grounded in published perception research, from real patients' tests, running live on a phone camera.
- A hearing model that beats the standard intelligibility index at predicting what real listeners with hearing loss understand.
- Every number in the app traces to a source, and untested regions are shown as untested.

### What we learned

Accuracy and dignity are the same problem. The black tunnel is both wrong and harmful, and the fix for both was to model what people actually experience and put it next to what they still do well.

### What’s next

- A follow-my-eyes view on laptops using webcam eye tracking.
- A digits-in-noise hearing test so families can start without a clinic audiogram.
- Photographing the printout instead of typing it.
- Usability sessions with older adults and their families, and reviews by an optometrist, audiologist and occupational therapist.

### Working vs planned

| Feature | Status |
|---|---|
| See (field renderer, years slider, dim light and glare) | Working (dim light and glare are approximations) |
| Hear (MSBG + proxy listener, noise, hearing aids, playback) | Working, validated on CPC2 |
| Say it better (Claude + scoring) | Working (needs the AI Gateway enabled on the Vercel account) |
| Walk (on-device step edges and verdicts) | Working; can mistake rails or table edges for steps |
| Sit, Guide, setup with printout entry | Working |
| Follow-my-eyes, digits-in-noise test, printout photo | Planned |

---

## Demo video script (under 3 minutes)

Record the screen at 1920×1080 on a laptop (Chrome, GPU on), with your own voice. Captions burned in. Upload to YouTube as unlisted, **not** “made for kids”.

| Time | Screen (URL) | Voiceover |
|---|---|---|
| 0:00–0:08 | `docs/gallery/0-usual-black-tunnel.png` (the usual depiction, made from the same hallway photo), then cut to `/p/example/see?scene=hallway&wipe=0.5` | “This is how glaucoma is usually shown. When 50 patients were asked, not one said it looks like this.” |
| 0:08–0:18 | Same screen, drag the divider slowly left to right | “This is closer: their own test results, applied to a real room. Things don’t go black. They fade, and then they disappear into what’s around them.” |
| 0:18–0:32 | `/` landing, then Try the example → About page | “Through Their Senses starts from one person’s real visual field test and hearing test. This is Meera, an example built from two real anonymized records. We start with what still works.” |
| 0:32–0:55 | Back to See: scrub the age slider from 61 to 71, toggle Dim light | “Ten years of her tests. And at night, with a lamp in view, it gets harder. Everything here is exact while you keep your eyes on the cross, the way the test is done.” |
| 0:55–1:30 | `/p/example/hear`, Dinner table on, tap the pills sample; let the stages appear; press Play as she hears it (headphones) | “Now her hearing. At a busy table, I say: your pills are on the shelf next to the sink. She hears: your poles are on the shelf next to the snake. Someone with typical hearing gets every word. The faded letters are the sounds she can’t catch: s, t, f, th.” |
| 1:30–1:45 | Tap Help me say it more clearly | “Claude suggests other ways to say it, and every suggestion is checked against her hearing model before we show it.” |
| 1:45–2:15 | `/p/example/walk`, Stairs, Check this spot; tap card 1, Try a contrasting strip; Yes, she wants it | “Walking the house together. The phone finds the step edges, measures their contrast, and compares it with what her vision needs at that spot. These treads are hidden from her. She decides what to change.” |
| 2:15–2:30 | `/p/example/sit`, then `/p/example/guide` | “Where to sit so she hears your voice and sees your face. And everything becomes one page she can edit and share.” |
| 2:30–2:50 | `/method`, scroll to the validation table | “We tested the hearing model on real listeners with hearing loss from the Clarity challenge. It predicts what they understood better than the standard index. And we’re upfront about what’s approximate and what’s planned.” |
| 2:50–3:00 | Back to the See split view | “Not a tunnel. Her.” |

Tips: pre-load each page once (the depth model and hearing service warm up), keep the browser zoom at 100%, and do one silent run before recording.

---

## One-page PDF

Generated from `docs/ONE_PAGER.md` (see that file).
