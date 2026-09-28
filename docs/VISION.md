# Through Their Senses: build vision (v2)

Working title. UnivaBio 2026 (theme: AI for Human Health). Deadline Oct 6, 2026, 11:45pm EDT.

One sentence: an older adult and their family load her real visual field test and audiogram, see the world and hear conversation the way she does, and build a shared plan for her home and for how the family talks with her.

Who it is for: older adults with glaucoma and age-related hearing loss, and the family members who live with them. Secondary: home-health aides and occupational therapists.

Why it matters:
- Public education shows glaucoma wrong. In Crabb et al. 2013, 0 of 50 patients chose a black-tunnel or black-patch image; 54% chose blurred patches, 16% missing patches, and 26% were unaware of their loss.
- Hearing loss is the largest modifiable dementia risk factor in the 2020 Lancet Commission (about 8% population-attributable fraction).
- Dual sensory impairment rises steeply with age (about 1.5% at 65 to 74, 10.8% at 85+) and carries worse outcomes than either loss alone: falls, loneliness, cognitive decline. Report dementia risk as a range across studies, never one number.
- Families are affected too. "Third-party disability" (WHO ICF) describes spouses who become the partner's ears and manage social situations. A meta-analysis found communication-partner interventions improve partners' lifestyle, communication, and emotional outcomes.

---

## 1. Design principles (these override feature ideas)

1. **"Being with," not "being like."** Disability simulations backfire when shown alone: Silverman et al. 2015 found blindness simulation made people rate blind people as *less* capable; Nario-Redmond et al. 2017 found simulation raised pity, fear, and helplessness. So every simulation screen pairs the rendering with what still works and how she adapts, plus a short credited quote from a published patient interview. The product teaches strategies, not shock.
2. **She is a user, not a subject.** She confirms or delegates her own profile. A banner reads "Shared by Meera" during simulation. Hazard fixes are options she accepts or declines. She co-owns and can edit the final guide. Walk mode is "walk it together," never "audit her home." (Grounded in dignity-of-risk and person-centered care; no direct study of this exact flow exists.)
3. **Language rules.** "How she sees now" and "what still works." Never "suffers," "handicapped," "victim," or deficit-only lists.
4. **One measurement, many views.** The field test and audiogram are entered once and drive the renderer, audit, hearing model, seating planner, and guide. Never ask twice.
5. **Honest by default.** Untested areas look untested. Estimates are labeled. Every number in the UI has a source one tap away.
6. **Depth over breadth in the demo.** Judges consistently reward one thing that works end to end over five half-working features. The product can hold more, but the demo shows three beats done perfectly.

---

## 2. Limitations and how each one gets solved

### Vision

| Limitation | Solution | Basis |
|---|---|---|
| Simulators draw black tunnels, which patients say is wrong | Render loss as removed local contrast using Peli's band-limited contrast model: split each frame into a Laplacian pyramid, compute local contrast per band, drop band contrast below her threshold at that point. Blur and fading emerge from the model. | Peli 1990; Crabb 2013 |
| dB-to-appearance mapping is usually invented | Humphrey dB is defined against a 10,000 asb max stimulus on a 31.5 asb background, so each value is a contrast threshold. Total deviation gives the multiplier `10^(TD/10)` on the normal threshold. | HFA dB definition; UWHVF TD values |
| Deep scotomas are filled in by the brain | In very deep loss, replace content with a heavy low-pass of the surround so objects vanish while background color continues (the "missing patches" answer). | Crabb 2013 |
| Real eyes move | **Fixation mode** (dot, exactly how the test is taken). **Follow-my-eyes mode** (gaze-contingent, see section 6 for device plan). **Walk mode** (gaze on the floor about two steps ahead). | OpenVisSim; Crabb lab VR work shows simulated defects change real head and eye movement |
| Two eyes, one world | Merge eyes with the best-location method into one binocular map. The Esterman binocular field used for driver licensing shows one binocular map is the accepted lay-facing format. | Crabb and Viswanathan 1998; Esterman |
| Test-retest noise | Fit pointwise linear regression across all visits; render the fit. Also drives the time slider. | UWHVF multi-visit data |
| 24-2 covers only the central 24 to 30 degrees | Hatched "untested" ring on the field map; audit says hazards beyond 30 degrees are unassessed. | Honest scope |
| Vision is worse in dim light and glare, which the field test does not capture | **Night hallway toggle**: a multiplicative threshold penalty for mesopic conditions plus a glare veil (local threshold elevation around bright sources using a standard veiling-luminance formula). Stays inside the Peli framework; labeled "defensible, not exact." | Glaucoma: lower contrast plateau and slower dark adaptation (PLOS ONE 2018), worse mesopic reading, about 70% report glare |
| Camera field of view unknown | Android Chrome: WebXR camera intrinsics. iPhone and laptop: one-time credit-card calibration (85.60 mm) plus device table. | WebXR Raw Camera Access |
| Generic object detection is not a hazard model | Depth (Depth Anything V2 small) finds drop-offs; open-vocabulary detection finds rugs, cords, clutter. Verdicts come from the same contrast model, and **inferior-field hazards are weighted higher**: inferior loss predicts falls (RR 1.57) and injurious falls (RR 1.80); superior loss did not. | Black et al. 2011 |

### Hearing

| Limitation | Solution | Basis |
|---|---|---|
| Audiogram models quietness only | Cambridge MSBG simulator (threshold elevation, loudness recruitment, spectral smearing) from pyClarity. | Clarity project |
| Phoneme lookup tables guess | **Proxy listener**: sentence → MSBG with her audiogram → Whisper. Misrecognized words are flagged with what she likely hears. Phoneme audibility remains the explanation layer. | Whisper-based intelligibility prediction papers (Clarity) |
| Proxy is not a human | Validate on CPC2: 25 listeners with hearing loss, their audiograms, and measured intelligibility on about 8,300 utterances. Report correlation and RMSE next to the HASPI baseline. | CPC2 (Zenodo); HASPI v2 |
| No audiogram on hand | Type it, photograph it (stretch), or take a digits-in-noise test (no calibrated headphones needed) mapped with age to the nearest Bisgaard standard audiogram. | Bisgaard 2010; NHANES |
| Quiet rooms hide the problem | Dinner-noise scene. Listeners with hearing loss need roughly +5 to +10 dB better signal-to-noise than the -5 to 0 dB normal listeners manage; default to about +8 dB. | Plomp-style SRT literature |
| Hearing aids | NAL-R gain toggle before MSBG. Note aids typically leave a residual noise deficit. | Byrne and Dillon 1986; pyClarity |
| LLM rewordings unverified | Generate candidates, score each with the proxy listener, show only improvements. Try rephrasing before repeating. Add clear-speech tips. | Picheny et al. 1985; UCSF EARS guidance |
| Latency | Transcript streams instantly; "her version" resolves 1 to 2 s later, which becomes the fade animation. | |
| Uncalibrated playback | One-time "set to normal speaking loudness" step; simulation labeled relative. | |

### Fusion

**Seating planner** with evidence-based constraints: within about 3 m, at 45 degrees or less off center (speechreading accuracy drops 14 to 22% at 90 degrees and falls sharply with distance, Erber), on her better-hearing side, face inside her intact field, face lit from the front not backlit. Central glaucomatous damage also impairs face recognition independent of acuity, which links the two senses directly.

---

## 3. Evidence numbers the product uses

| Number | Where it appears | Source |
|---|---|---|
| 0 of 50 chose black patches; 54% blur; 26% unaware | Hook, See screen | Crabb 2013 |
| Inferior field loss: falls RR 1.57, injurious falls RR 1.80 | Walk weighting and verdict text | Black 2011 |
| Step edges need at least 50% Weber contrast; tape flush with the tread nose | Walk verdicts and fixes | Stair-edge contrast studies; UK stair nosing standard |
| Home hazard removal reduces falls about 38% in higher-risk older adults, more when led by an OT | Walk intro, rigor slide ("the intervention class with the strongest evidence," not a claim about this app) | Cochrane; VIP trial |
| About 200 lux corridors, about 500 lux task areas for older adults | Lighting check (approximate, from camera exposure, labeled estimate) | IES RP-28 summaries |
| Speechreading: within about 3 m, 45 degrees or less | Seating planner | Erber |
| +5 to +10 dB SNR need | Dinner-noise default | SRT literature |
| Lancet 8% PAF; dual-impairment prevalence by age | Rigor slide | Lancet 2020; scoping review |

---

## 4. Product

### Screens
1. **Set up together.** She (or a family member with her) creates the profile, confirms the data, chooses who it is shared with. Data sources: a real anonymized UWHVF eye, typed values, or digits-in-noise for hearing. Profile card shows one binocular field map and a **familiar-sounds audiogram** (dog bark, doorbell, leaves, speech sounds plotted at their real pitch and loudness under her curve), plus a "What still works" list (for example: sharp central vision, clear low-pitched voices).
2. **See.** Live camera through her eyes. Wipe handle compares views. Time slider replays her visits. Modes: fixation, follow my eyes, walk, night hallway. Side panel: "How she adapts" (scans with her head, needs more light) with a credited patient quote.
3. **Hear.** Speak normally; transcript appears, then letters fade by audibility; "She likely hears: ..." below. Toggles for dinner noise and hearing aids. Fix shows verified rewordings. Play hears yourself through her ears.
4. **Walk it together.** Walk a route; pins show verdicts ("Step edge: hard for her to see here, 18% contrast, 50% recommended"). Each fix is an option she can accept or decline, then re-scored live. Inferior-field hazards ranked first. Recordings of the route are saved for follow-my-eyes on a laptop.
5. **Sit.** Top-down seating planner using both models.
6. **Our guide.** One printable card built like communication-partner training, not a fact sheet: how to talk with her, where to sit, home changes she chose, and her own strategies credited to her. She can edit before sharing. Every item links to its source.

### Design system
- Warm and editorial, not clinical. Off-white paper, deep ink, one amber accent.
- **Type:** Atkinson Hyperlegible Next for UI and body (designed by the Braille Institute for low-vision readers, which is itself a story point); a warm serif such as Newsreader or Fraunces for headlines.
- **Shared metaphor:** vision blurs the world; hearing fades the letters.
- **Signature transition:** the 54 dots of her field test lift off the chart and expand into the live camera view, built on the View Transitions API (supported in Chrome 111+, Firefox 133+, Safari 18+), with a cross-fade fallback.
- **Motion:** critically damped springs (no bounce) everywhere; slight overshoot only on the signature transition. Micro-interactions 100 to 150 ms, cards 200 to 300 ms, full-screen up to 500 ms.
- **Camera screens:** full-bleed, controls in the bottom thumb zone, status line at top ("Fixation · both eyes · 2023"). Wipe handle jumps to the touch point, uses `clip-path`, and is keyboard focusable.
- **Hazard pins:** label offset 12 to 20 px with a thin leader line; state shown by shape and icon plus color, never color alone; redundant feedback channels (pin, one-line text, optional tone), each toggleable, as in Apple Magnifier's detection mode.
- **No haptics on iPhone:** iOS Safari has no Vibration API. Use a visual pulse plus optional tone; Android vibration is a bonus only.
- **Model downloads:** never automatic. An explicit "Set up vision tools" tap, staged progress with sizes, cached so repeat demos are instant.

### Accessibility (the app must serve her too)
- 44 x 44 px targets (WCAG AAA 2.5.5), AA contrast minimum, large-text mode.
- Plain-language gloss the first time any control appears ("Drag to compare what you see with what she sees").
- A consistent "What am I looking at?" help button on every screen (WCAG 3.2.6).
- Captions and a text alternative for every audio moment.

---

## 5. Demo and submission

### 3-minute video
| Time | Beat |
|---|---|
| 0:00 to 0:10 | Pitch in the first seconds: the black-tunnel image, "0 of 50 patients said it looks like this," cut to the blurred version, one-line product description. |
| 0:10 to 0:30 | Set up together: real anonymized field test and audiogram load; the dots lift into the camera. |
| 0:30 to 1:05 | See: wipe, time slider, "How she adapts" panel. |
| 1:05 to 1:35 | Walk it together: inferior step edge flagged at 18% contrast vs 50% needed; she accepts contrast tape; verdict flips. |
| 1:35 to 2:15 | Hear: "I'll pick you up at fifteen past six." Letters fade; "She likely hears: fifty past six." Noise makes it worse, aids help, a verified rewording fixes it. |
| 2:15 to 2:35 | Sit and Our guide assemble. |
| 2:35 to 3:00 | Rigor: CPC2 result with HASPI baseline, method sources, informal feedback labeled as such, finished-vs-planned list. |

Checklist: under 3 minutes; mostly live product, not slides; own voiceover from a written, rehearsed script; captions burned in; screen capture at full resolution; YouTube unlisted and not "made for kids."

### Devpost page
- Cover and gallery at 5:3 (1500 x 900), every gallery image captioned.
- Standard sections in order: Inspiration, What it does, How we built it, Challenges, Accomplishments, What we learned, What's next.
- A "Working vs planned" table in the write-up itself.
- Validation numbers always with baseline, dataset, and n.

### One-page PDF
Labeled blocks: problem, solution, key technical bet, validation, limits (one visible line), what's next. One hero screenshot.

### Human input (honest and ethical)
- Informal usability feedback from 1 to 3 older adults and family members, with consent, no health data recorded. Report as "informal usability feedback, not a clinical study, not IRB-reviewed; directional."
- Email a local optometrist and audiologist for a two-sentence reaction; attribute as informal clinician feedback, never validation.

### Live judging
Hand the judge the phone in See mode, then have them speak a sentence in Hear. Rehearse the exact click path many times, freeze code a few hours before, keep recorded fallback clips of every beat.

---

## 6. Architecture

- **Frontend:** Next.js App Router on Vercel, installable PWA. Custom GPU renderer (Laplacian pyramid, per-pixel threshold texture). MediaPipe FaceLandmarker for gaze. transformers.js for Depth Anything V2 small and an open-vocabulary detector, with a server fallback.
- **Follow-my-eyes device plan:** primary on a laptop, where the webcam tracks the viewer's eyes over a Walk recording of her real route. Phone version only if simultaneous front and rear cameras prove possible.
- **Hearing service:** Python (FastAPI) on a GPU host with pyClarity (MSBG, NAL-R, HASPI), Whisper with word timestamps, CMUdict plus grapheme-to-phoneme, and Claude for rewording candidates scored before display.
- **Data:** UWHVF (pick a 70 to 75 year old eye with a glaucoma-pattern field and denser inferior loss, MD about -6 to -10 dB; UWHVF has no diagnosis field, so describe it as a glaucoma-pattern field), NHANES audiometry (a typical sloping age-related audiogram near Bisgaard N3/N4), Bisgaard profiles, CPC2 for validation only.
- **Privacy:** camera frames stay on device; audio sent per utterance and not stored.

### Technical questions to verify on day 1 (research incomplete)
1. WebGPU availability in current iOS Safari vs a WebGL2 path; frame rate of a 6-level pyramid at 1080p on a mid-range phone.
2. Whether any mobile browser allows front and rear cameras at once.
3. In-browser Depth Anything V2 small and detector latency on iPhone; decide client vs server.
4. MSBG runtime per utterance and whether a faster alternative (for example Neuro-MSBG) or a Web Audio port is needed for playback.
5. WebXR camera intrinsics on current Android Chrome.

---

## 7. Validation plan
- **Hearing:** proxy listener vs CPC2 listener scores, correlation and RMSE next to HASPI. Word-level agreement too if CPC2 includes listener transcripts.
- **Vision:** unit tests (TD = 0 is identity, deeper loss removes monotonically more contrast, binocular merge matches best-location, fits track raw visits, audit verdicts use the renderer's threshold map). State that the renderer follows published methods but was not tested with patients.

## 8. Limits that remain
- Phone gaze tracking is coarse; fixation mode is exact.
- Perimetry measures one spot size; applying its threshold across spatial bands is an assumption.
- Night and glare modes are defensible approximations, not measured for her.
- The proxy listener is validated on CPC2 listeners, not on her.
- Not a diagnostic tool.

## 9. Scope tiers and build order
- **Tier 1 (the demo):** See (fixation mode, wipe, time slider), Hear (fading transcript, proxy listener, verified rewording), Our guide, set-up-together flow, CPC2 validation.
- **Tier 2:** Walk it together, Sit.
- **Tier 3:** Follow-my-eyes, night hallway and glare, digits-in-noise, audiogram photo, lighting check.
- **Later (What's next):** a second condition such as diabetic retinopathy, using open labeled datasets (APTOS, EyePACS).

Order: day-1 technical checks, vision renderer, hearing pipeline offline plus CPC2, live Hear, set-up and guide, Walk, Sit, Tier 3, polish, usability feedback, fallbacks, video.

## Sources
Perception and methods
- Crabb 2013: https://pubmed.ncbi.nlm.nih.gov/23415421/
- Peli 1990: https://pubmed.ncbi.nlm.nih.gov/2231113/
- OpenVisSim: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7064490/
- Crabb lab VR follow-up: https://www.eurekalert.org/news-releases/713045
- Esterman binocular field: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3479058/
- Glaucoma dark adaptation: https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0193663
- Glaucoma mesopic reading: https://pmc.ncbi.nlm.nih.gov/articles/PMC10756241/
- Glaucoma glare: https://pmc.ncbi.nlm.nih.gov/articles/PMC8169840/
- Face recognition in glaucoma: https://pmc.ncbi.nlm.nih.gov/articles/PMC5826536/

Falls and home
- Black 2011, inferior field and falls: https://pubmed.ncbi.nlm.nih.gov/21873923/
- VIP trial: https://pubmed.ncbi.nlm.nih.gov/16183652/
- Cochrane home hazards: https://www.cochrane.org/about-us/news/cochrane-review-shows-reducing-trip-hazards-and-decluttering-can-prevent-falls-among-older
- Stair edge contrast: https://www.sciencedirect.com/science/article/abs/pii/S0003687021001721 and https://www.ncbi.nlm.nih.gov/books/NBK305255/
- Lighting for older adults: https://pmc.ncbi.nlm.nih.gov/articles/PMC3819174/

Hearing and communication
- pyClarity: https://github.com/claritychallenge/clarity
- CPC2: https://zenodo.org/records/17045970 and https://claritychallenge.org/docs/cpc2/cpc2_intro
- Whisper-based intelligibility prediction: https://arxiv.org/pdf/2309.09548
- Bisgaard 2010: https://pubmed.ncbi.nlm.nih.gov/20724358/
- NHANES audiometry: https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2017/DataFiles/AUX_J.htm
- Speechreading distance and angle (Erber): https://pubs.asha.org/doi/10.1044/jshr.1701.99
- SNR needs: https://pubs.asha.org/doi/10.1044/jshr.2902.146
- UCSF EARS communication strategies: https://ears.ucsf.edu/en/living-well/communication-strategies
- Speech banana: https://en.wikipedia.org/wiki/Speech_banana

Population and families
- Dual sensory impairment: https://pmc.ncbi.nlm.nih.gov/articles/PMC10187940/ and https://academic.oup.com/ageing/article/54/9/afaf267/8266847
- Lancet Commission summary: https://www.psychiatrist.com/news/lancet-commission-identifies-2-new-modifiable-dementia-risk-factors/
- Third-party disability: https://pubs.asha.org/doi/10.1044/arii18.1.3
- Communication-partner meta-analysis: https://www.ovid.com/jnls/ear-hearing/abstract/10.1097/aud.0000000000001424~hear-me-out-a-meta-analysis-of-third-party-disability-due-to
- Living with glaucoma: https://link.springer.com/article/10.1186/s12886-015-0119-7

Simulation ethics
- Silverman 2015: https://journals.sagepub.com/doi/abs/10.1177/1948550614559650
- Nario-Redmond 2017: https://pubmed.ncbi.nlm.nih.gov/28287757/
- The Promise of Empathy (CHI 2019): https://dl.acm.org/doi/fullHtml/10.1145/3290605.3300528
- Dignity of risk: https://www.mja.com.au/journal/2025/223/4/dignity-risk-residential-aged-care-call-reframe-understandings-risk

UX and craft
- Apple Magnifier detection: https://support.apple.com/guide/iphone/detect-doors-people-and-furniture-around-you-iph35c335575/ios
- View Transitions API: https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API
- WCAG 2.2 target size: https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html
- NN/g older users: https://www.nngroup.com/articles/define-techy-words-old-users/

Submission
- Devpost demo video tips: https://info.devpost.com/blog/6-tips-for-making-a-hackathon-demo-video
- Devpost judging tips: https://info.devpost.com/blog/hackathon-judging-tips
- Devpost image sizes: https://help.devpost.team/article/257-supported-image-sizes-and-types
- IRB and usability testing: https://www.emergobyul.com/news/institutional-review-board-irb-approval-necessary-usability-tests
