import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import credits from "../../../public/scenes/credits.json";
import hazardEval from "@/content/hazard-eval.json";
import printoutEval from "@/content/printout-eval.json";

export const metadata = { title: "How it works · Through Their Senses" };

interface Metric {
  rmse: number;
  pearson: number;
  spearman?: number;
  rmse_ci?: [number, number];
  pearson_ci?: [number, number];
}

interface Validation {
  n_signals: number;
  n_listeners: number;
  ours_raw?: Metric;
  ours_cal?: Metric;
  production_base_en?: { raw?: Metric; cal?: Metric };
  haspi_cal?: Metric;
  pta_cal?: Metric;
  mean_baseline?: Metric;
  published?: Record<string, unknown>;
  word_level?: Record<string, number>;
  alternative?: Record<string, Metric>;
  summary?: string;
}

function loadValidation(): Validation | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), "src/content/validation.json"), "utf8"));
  } catch {
    return null;
  }
}

const fmt = (x: number | undefined, d = 1) => (typeof x === "number" ? x.toFixed(d) : "–");

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mt-14 scroll-mt-6" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="text-title font-light">
        {title}
      </h2>
      <div className="mt-4 space-y-4 leading-relaxed text-ink/90">{children}</div>
    </section>
  );
}

const steps = hazardEval.test;
const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;

const STATUS: [string, "Working" | "Approximation" | "Planned", string][] = [
  ["Vision through a real visual field test", "Working", "UWHVF fields, or numbers from a printout (typed or read from a photo); Peli contrast model on camera or photos."],
  ["Change over the years", "Working", "Pointwise trend across every visit for that eye."],
  [
    "Dim light and glare",
    "Working",
    "Light levels measured in real homes; Barten’s contrast model, glaucoma’s diffuse loss deepening in dim light, and CIE glare at the person’s age. Lamp brightness, eye colour and wall reflectance are assumed, not measured.",
  ],
  [
    "Follow-my-eyes (gaze-contingent) view",
    "Working",
    "Laptop webcam with on-device face tracking. After calibration it measures its own accuracy and won’t follow if it’s worse than 7°. So far checked with a recorded face, not yet across many real webcams.",
  ],
  [
    "Step edges on the walk-through",
    "Working",
    `On-device depth model plus contrast measured on the photo. On ${steps.after.stairPhotos + steps.after.noStepPhotos} held-out photos it found stairs in ${steps.after.stairPhotosWithAnEdge} of ${steps.after.stairPhotos}, and marked ${steps.after.falseEdgesPerNoStepPhoto} false edges per room without steps (down from ${steps.before.falseEdgesPerNoStepPhoto}).`,
  ],
  ["Hearing through a real audiogram", "Working", "Cambridge MSBG simulator and a proxy listener, validated against real listeners (below)."],
  ["Better ways to say it", "Working", "Claude writes options; each is spoken by one synthetic voice and scored by the same hearing model."],
  ["Seating planner", "Working", "Rules from hearing and vision research, not a trained model."],
  ["Hearing test in the app", "Working", "A beep test on headphones, compared with someone with typical hearing on the same headphones. An estimate, about ±10 dB, not a clinical audiogram."],
  [
    "Photographing a printout",
    "Working",
    `Claude reads the Total Deviation numbers and the person checks every one. On ${printoutEval.printouts} synthetic printouts read ${printoutEval.readsPerPrintout} times each: ${pct(printoutEval.exactRate)} of numbers exact, ${pct(printoutEval.wrong / printoutEval.values)} wrong, the rest left blank to type.`,
  ],
];

export default function Method() {
  const v = loadValidation();
  return (
    <main className="mx-auto max-w-2xl px-5 pb-24 pt-[max(1.25rem,env(safe-area-inset-top))]">
      <header className="flex items-center justify-between">
        <Link href="/" className="min-h-11 content-center font-bold">
          Through Their Senses
        </Link>
        <Link href="/p/example" className="min-h-11 content-center underline decoration-ink/25 underline-offset-4">
          Try the example
        </Link>
      </header>
      <h1 className="mt-10 text-display font-light tracking-[-0.02em]">How it works</h1>
      <p className="mt-4 max-w-[58ch] text-[1.12rem] leading-relaxed text-ink/80">
        Every picture and every sentence here comes from a model of one person’s real test results. This page explains those models, how well they hold up, and what they can’t do.
      </p>
      <nav aria-label="On this page" className="mt-6 flex flex-wrap gap-2 text-[0.95rem]">
        {[
          ["vision", "Vision"],
          ["hearing", "Hearing"],
          ["validation", "How well it matches real people"],
          ["status", "What’s finished"],
          ["limits", "Limits"],
          ["privacy", "Privacy"],
          ["credits", "Data and credits"],
        ].map(([id, label]) => (
          <a key={id} href={`#${id}`} className="min-h-11 content-center rounded-full bg-ink/[0.06] px-4 hover:bg-ink/[0.1]">
            {label}
          </a>
        ))}
      </nav>

      <Section id="vision" title="Vision">
        <p>
          A Humphrey 24-2 visual field test measures, at 54 points, how dim a spot of light each eye can still detect. We use its <em>total deviation</em>: how many decibels worse each point is than
          typical for that age. Both eyes are merged into one map with the best-location rule: at each point, the better eye wins, as it does in everyday life (Crabb and Viswanathan, 1998). Across
          repeated tests we fit a straight-line trend at each point, because a single test is noisy.
        </p>
        <p>
          The renderer follows Peli’s model of contrast in images (Peli, 1990). Each camera frame is split into detail levels, from fine to coarse. At every pixel we compute how much contrast each level
          carries, remove any contrast weaker than that person’s threshold at that point in their field, and reduce the rest by the threshold so detail fades smoothly. A loss of TD decibels raises the threshold by 10<sup>−TD/10</sup> over a normal contrast
          sensitivity curve. Where loss is deep, every level is removed except the coarsest: objects disappear into the colour around them.
        </p>
        <p>
          That matches what people with glaucoma report. When 50 patients compared pictures to their own sight, none chose the black tunnel or black patches used in most public images; they chose
          blurred or missing patches (Crabb et al., 2013).
        </p>
        <p>
          On the walk-through, a depth model running on the phone finds likely step edges. We measure each edge’s contrast in the photo and compare it with that person’s threshold where it falls in
          their field. Loss in the lower field is the part linked to falls (Black et al., 2011), so those edges come first. Step edges should reach 50% contrast for people with low vision.
        </p>
        <p>
          Depth models also see a jump in depth at a table edge, a sofa or a doorway. We keep an edge only when the surface on both sides of it is flat and slopes the same way, as two stair treads
          do. We chose that rule on {hazardEval.dev.after.stairPhotos + hazardEval.dev.after.noStepPhotos} photos and then checked it once on {steps.after.stairPhotos + steps.after.noStepPhotos} others
          from Wikimedia Commons, labelled beforehand. False edges in rooms without steps fell from {steps.before.falseEdgesPerNoStepPhoto} to {steps.after.falseEdgesPerNoStepPhoto} per photo; stairs
          were found in {steps.after.stairPhotosWithAnEdge} of {steps.after.stairPhotos} photos, against {steps.before.stairPhotosWithAnEdge} before. Missing a few stairs is the cost.
        </p>
        <p>
          Light changes all of this. The Evening and TV-light scenes use eye-level light measured in 30 homes (Miller and Kinzey, 2018). In dim light everyone loses contrast sensitivity, more for
          fine detail; Barten’s model (1999) gives how much at each detail level. Glaucoma adds to it: the diffuse part of the loss deepens in dim light while local blind patches stay as they are
          (Drum et al., 1986). Around lamps and windows, light scattered inside the eye lays a veil over the scene. We compute it for every point from the CIE 146:2002 glare formula at the person’s
          age, and at 25 on the “you” side. Three things are assumed rather than measured: how bright the lamp is, eye colour and how much light the walls reflect.
        </p>
        <p>
          On a laptop, the view can follow where you look. The webcam finds your face and eyes with MediaPipe, on the device, and a 13-dot calibration maps them to the screen. It then measures its
          own accuracy by leaving each dot out in turn and predicting it from the others. Published webcam eye trackers land within about 1.5 to 4°; the field test points are 6° apart, so the view
          only follows when the check comes in under 7°.
        </p>
      </Section>

      <Section id="hearing" title="Hearing">
        <p>
          An audiogram gives the quietest level each ear hears at each pitch. The Cambridge MSBG hearing loss simulator (Moore, Stone, Baer and Glasberg; open-source in the Clarity project) turns that
          into sound: it raises thresholds, makes loudness grow unevenly, and smears pitch detail. Your recording is set to a normal speaking level (65 dB SPL) first, and the dinner-table setting adds
          eight talkers of background chatter.
        </p>
        <p>
          To say what the person probably heard, a speech recogniser (Whisper base.en) listens to the simulated sound with each ear, and we keep the ear that catches more. On its own it would pick up sounds far too quiet for anyone, so we add a noise
          floor at the normal hearing threshold (ISO 226:2003) first. Words it can’t make out with confidence are shown as “…” instead of a guess.
        </p>
        <p>
          The faded letters are an explanation, not the prediction: each speech sound sits at its usual pitch and loudness in conversation, and fades by how far it falls below that person’s hearing.
        </p>
        <p>
          Without an audiogram, the app can test hearing itself. Browsers can’t know how loud their headphones are, so two people take the same beep test on the same headphones at the same
          volume: first someone with typical hearing, then the person. The difference between them, plus the typical loss for the helper’s age (ISO 7029:2017), is the person’s hearing loss.
          In published studies of this kind of calibration against normal-hearing listeners, results differed from clinical audiometry with a standard deviation of about 7 to 10 dB (Masalski et al., 2014 and 2018). Each pitch uses
          the standard clinical method of stepping down 10 dB and up 5 dB, with catch trials and a repeat at 1 kHz to check reliability. In a full simulated run it recovered a known audiogram within
          5 dB at every pitch.
        </p>
      </Section>

      <Section id="validation" title="How well it matches real people">
        <p>
          We tested the proxy listener on the Clarity Prediction Challenge (CPC2) evaluation set: people with hearing loss listened to sentences in noise and repeated back what they heard, with their
          audiograms recorded.
        </p>
        {v ? (
          <>
            <p>
              {v.n_signals} sentences, {v.n_listeners} listeners. Lower RMSE (in percentage points of words correct) and higher correlation are better.
            </p>
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Validation results">
              <table className="w-full min-w-[30rem] text-left text-[0.95rem] tabular">
                <thead className="border-b border-chart text-graphite">
                  <tr>
                    <th className="py-2 pr-3 font-normal">Method</th>
                    <th className="py-2 pr-3 font-normal">RMSE</th>
                    <th className="py-2 pr-3 font-normal">Correlation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-chart">
                  {(
                    [
                      ["Our proxy listener (Whisper small.en), calibrated", v.ours_cal],
                      ["As deployed in the app (Whisper base.en), calibrated", v.production_base_en?.cal],
                      ["Our proxy listener (small.en), uncalibrated", v.ours_raw],
                      ["Without the noise floor, small.en (not chosen, see below)", v.alternative?.["alternative: floor OFF, small.en"]],
                      ["HASPI (standard intelligibility index), calibrated", v.haspi_cal],
                      ["Audiogram average only", v.pta_cal],
                      ["Always guess the average", v.mean_baseline],
                    ] as [string, Metric | undefined][]
                  )
                    .filter(([, m]) => m)
                    .map(([name, m]) => (
                      <tr key={name}>
                        <td className="py-2 pr-3">{name}</td>
                        <td className="py-2 pr-3">
                          {fmt(m!.rmse)}
                          {m!.rmse_ci && <span className="text-graphite"> ({fmt(m!.rmse_ci[0])}–{fmt(m!.rmse_ci[1])})</span>}
                        </td>
                        <td className="py-2 pr-3">
                          {fmt(m!.pearson, 2)}
                          {m!.pearson_ci && <span className="text-graphite"> ({fmt(m!.pearson_ci[0], 2)}–{fmt(m!.pearson_ci[1], 2)})</span>}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {v.summary && <p>{v.summary}</p>}
            <p>
              Whether to add the hearing-threshold noise floor was decided on separate CPC2 training sentences by a rule we wrote down before running it: the floor stays unless
              removing it lowers error by more than half a point. It lowered it by 0.3, so the floor stayed. On the test set, removing it would have scored better. We report that
              rather than switch, because choosing on test results would overstate how well the model works.
            </p>
            <p className="text-sm text-graphite">
              Calibrated means a logistic mapping fitted with 5-fold cross-validation that keeps each listener’s sentences in one fold. Brackets are 95% bootstrap intervals. Full details are in the
              repository’s validation/RESULTS.md.
            </p>
          </>
        ) : (
          <p className="text-graphite">The validation run is in progress; results will appear here.</p>
        )}
      </Section>

      <Section id="status" title="What’s finished">
        <ul className="divide-y divide-chart border-y border-chart">
          {STATUS.map(([what, status, note]) => (
            <li key={what} className="py-3">
              <p className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-bold">{what}</span>
                <span className={`text-[0.9rem] ${status === "Working" ? "text-works" : status === "Planned" ? "text-graphite" : "text-ink"}`}>{status}</span>
              </p>
              <p className="mt-1 text-[0.95rem] text-graphite">{note}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="limits" title="Limits">
        <ul className="list-disc space-y-2 pl-5">
          <li>The vision view is exact only while you look at the cross, because the test is done with the eye held still. Real eyes move and fill in a lot.</li>
          <li>The test measures one size of spot. Using its threshold for every level of detail is an assumption.</li>
          <li>The 24-2 test only covers the central 24 to 30 degrees. We mark the rest as untested rather than guess.</li>
          <li>The proxy listener is a model of a listener, checked against the CPC2 listeners, not against the person in the profile. Speech recognisers also do worse than people in heavy noise.</li>
          <li>Dim light and glare use published averages. They are not measured for this person, and lamp brightness is assumed because photos can’t record it.</li>
          <li>The in-app hearing test is an estimate, about ±10 dB. It relies on the helper really having typical hearing, and on nobody changing the volume in between.</li>
          <li>Printout reading was checked on synthetic printouts made from real fields, because no real printout is openly licensed. Every number has to be checked by the person before it’s used.</li>
          <li>It does not diagnose anything and does not replace an eye doctor, audiologist or occupational therapist.</li>
        </ul>
      </Section>

      <Section id="privacy" title="Privacy">
        <p>
          Profiles are saved only in the browser where you make them. Camera frames and the walk-through photos never leave the phone: the depth model runs on it. When you record a sentence on the Hear
          screen, that audio goes to our hearing service, is processed, and is not stored. Suggested rewordings send the sentence text to an AI model. A photo of a printout is sent to an AI model to read the numbers and is not stored.
          Webcam eye tracking runs entirely on the device.
        </p>
      </Section>

      <Section id="credits" title="Data and credits">
        <ul className="list-disc space-y-2 pl-5 text-[0.98rem]">
          <li>
            Visual fields: UWHVF, Montesano G, Chen A, Lu R, Lee CS, Lee AY. <em>Transl Vis Sci Technol</em> 2022;11(1):2. BSD-3-Clause.
          </li>
          <li>Hearing tests: CDC/NCHS National Health and Nutrition Examination Survey 2017–2018, audiometry. Public domain.</li>
          <li>Validation data: Clarity Prediction Challenge 2 (CPC2), CC BY-SA 4.0.</li>
          <li>
            Quotes: Glen FC, Crabb DP. Living with glaucoma: a qualitative study of functional implications and patients’ coping behaviours. <em>BMC Ophthalmology</em> 2015;15:128. CC BY 4.0.
          </li>
          <li>Hearing loss simulator and NAL-R: pyClarity (MIT). Speech recognition: Whisper (MIT) via faster-whisper. Synthetic voices and background chatter: Kokoro-82M (Apache-2.0).</li>
          <li>Depth: Depth Anything V2 Small (Apache-2.0), run with Transformers.js.</li>
          <li>Face and eye tracking: MediaPipe Face Landmarker (Apache-2.0).</li>
          <li>Step-edge test photos: Wikimedia Commons, each with its own licence, listed in the repository’s web/scripts/hazard-set.json.</li>
          <li>Typeface: Atkinson Hyperlegible Next, Braille Institute (SIL Open Font License).</li>
          {credits.map((c) => (
            <li key={c.id}>
              Photo “{c.title.replace(/\.jpg$/, "")}” by {c.artist}, {c.license},{" "}
              <a href={c.source} className="underline decoration-ink/25 underline-offset-2" target="_blank" rel="noreferrer">
                Wikimedia Commons
              </a>
              . Shown through the vision model.
            </li>
          ))}
        </ul>
        <p className="text-sm text-graphite">
          Key references: Crabb DP et al., Ophthalmology 2013; Peli E, JOSA A 1990; Crabb DP, Viswanathan AC, Graefe’s Arch 1998; Black AA et al., IOVS 2011; Erber NP, J Speech Hear Res 1974; Silverman
          AM et al., Soc Psychol Personal Sci 2015; Scarinci N et al., on third-party disability; Barten PGJ, Contrast Sensitivity of the Human Eye, SPIE 1999; CIE 146:2002, CIE equations for
          disability glare; Drum B, Armaly MF, Huppert W, Arch Ophthalmol 1986; Miller NJ, Kinzey BR, IES LD+A 2018; Watson AB, Yellott JI, J Vis 2012; ISO 7029:2017; Masalski M et al., J Med
          Internet Res 2014 and JMIR mHealth uHealth 2018.
        </p>
      </Section>
    </main>
  );
}
