// Accuracy check for /api/read-printout on synthetic Humphrey-style 24-2 printouts.
// No real printout is openly licensed, so each one is drawn from a real UWHVF visit in
// public/data/fields: a threshold plot, the Total Deviation plot (the truth) and a Pattern
// Deviation decoy, then made to look like a phone photo (perspective, rotation, uneven light,
// blur, noise, JPEG). Every eye of every library profile is used.
// Usage (dev server on :3100): npx tsx scripts/printout-eval.mts [outDirForPhotos]
// DRY=1 only renders the photos.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PRINTOUT_ROWS, isBlindSpot } from "../src/lib/field.ts";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH ?? `${process.env.HOME}/.claude/skills/gstack/node_modules/playwright`);
const API = process.env.API ?? "http://localhost:3100/api/read-printout";
const out = process.argv[2];
if (out) mkdirSync(out, { recursive: true });

let seed = 4;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0), seed / 2 ** 32);
const uni = (a: number, b: number) => a + (b - a) * rand();

type Eye = "right" | "left";
type Case = { name: string; eye: Eye; age: number; md: number; rows: (number | null)[][]; html: string };
const data = new URL("../public/data/", import.meta.url).pathname;
const profiles = (JSON.parse(readFileSync(`${data}fields.json`, "utf8")) as { profiles: { id: string }[] }).profiles;

const plot = (vals: Map<string, number>) => {
  const cells: string[] = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 10; c++) cells.push(`<div class="c">${vals.get(`${r},${c}`) ?? ""}</div>`);
  return `<div class="plot"><div class="ax h"></div><div class="ax v"></div><div class="g">${cells.join("")}</div></div>`;
};

const cases: Case[] = [];
for (const p of profiles) {
  const d = JSON.parse(readFileSync(`${data}fields/${p.id}.json`, "utf8"));
  const v = d.visits[d.visits.length - 1];
  for (const eye of ["right", "left"] as Eye[]) {
    const td = new Map<string, number>();
    const rows = PRINTOUT_ROWS.map((row, r) =>
      row[eye].map((c) => {
        const x = v[eye][r][c];
        if (isBlindSpot(eye, r, c) || x === null) return null;
        td.set(`${r},${c}`, Math.round(x));
        return Math.round(x);
      }),
    );
    const all = [...td.values()];
    const md = all.reduce((a, b) => a + b, 0) / all.length;
    // Pattern Deviation removes the general height (7th-best TD), so it differs from TD by a constant where the field is depressed.
    const gh = all.length > 7 ? [...all].sort((a, b) => b - a)[6] : 0;
    const pd = new Map([...td].map(([k, x]) => [k, gh < 0 ? Math.min(0, x - gh) : x]));
    const thr = new Map([...td].map(([k, x]) => [k, Math.max(0, Math.round(30 + x + uni(-1.5, 1.5)))]));
    const age = Math.round(v.age);
    const html = `<h1>Central 24-2 Threshold Test</h1>
<div class="hd"><span>Patient: ********</span><span>Eye: ${eye === "right" ? "Right (OD)" : "Left (OS)"}</span><span>Age: ${age}</span><span>Strategy: SITA Standard</span></div>
<div class="sm" style="margin-top:6px">Fixation Monitor: Gaze/Blindspot &nbsp; Fixation Losses: 0/14 &nbsp; False POS Errors: 2% &nbsp; False NEG Errors: 4% &nbsp; Stimulus: III, White &nbsp; Background: 31.5 ASB</div>
<div class="row"><div>${plot(thr)}<div class="lbl">Threshold (dB)</div></div><div class="sm" style="width:300px;padding-top:40px">GHT: Outside normal limits<br><br>VFI: ${Math.max(0, Math.round(100 + md * 2.5))}%<br>MD: ${md.toFixed(2)} dB P &lt; 0.5%<br>PSD: ${Math.abs(gh - md).toFixed(2)} dB P &lt; 0.5%</div></div>
<div class="row"><div>${plot(td)}<div class="lbl">Total Deviation</div></div><div>${plot(pd)}<div class="lbl">Pattern Deviation</div></div></div>`;
    cases.push({ name: `${p.id}-${eye}`, eye, age, md, rows, html });
  }
}

// The photo: the sheet tilted in 3D and rotated on a dark table, lit unevenly, slightly blurred and noisy, saved as JPEG.
const STYLE = `html,body{margin:0;background:#463c32;width:910px;height:1000px;overflow:hidden;perspective:1400px}
.sheet{font-family:Arial,Helvetica,sans-serif;background:#fbfbf7;color:#111;width:850px;padding:30px;box-sizing:content-box;transform-origin:50% 50%}
h1{font-size:20px;margin:0}.hd{display:flex;justify-content:space-between;font-size:13px;margin-top:6px;border-bottom:1px solid #999;padding-bottom:6px}
.row{display:flex;gap:40px;margin-top:18px}.lbl{font-size:12px;font-weight:bold;text-align:center;margin-top:4px}
.plot{position:relative;width:330px;height:230px}.g{position:absolute;inset:0;display:grid;grid-template-columns:repeat(10,33px);grid-template-rows:repeat(8,28.75px)}
.c{font-size:14px;text-align:center;line-height:28px}.ax{position:absolute;background:#555}.ax.h{left:0;right:0;top:115px;height:1px}.ax.v{top:0;bottom:0;left:165px;width:1px}
.sm{font-size:11px;color:#333}.light,.noise{position:fixed;inset:0;pointer-events:none}.light{mix-blend-mode:multiply}.noise{opacity:.22;mix-blend-mode:overlay}`;
const NOISE = `<svg class="noise" width="910" height="1000"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="SEED"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 910, height: 1000 }, deviceScaleFactor: 0.85 });
const photos: string[] = [];
for (const [i, k] of cases.entries()) {
  const t = `rotateX(${uni(-9, 9).toFixed(1)}deg) rotateY(${uni(-9, 9).toFixed(1)}deg) rotate(${uni(-4, 4).toFixed(1)}deg) scale(0.94)`;
  const light = `linear-gradient(${Math.round(uni(0, 360))}deg, rgb(255,248,230) 0%, rgb(${Math.round(uni(185, 215))},${Math.round(uni(180, 205))},${Math.round(uni(165, 190))}) 100%)`;
  await page.setContent(
    `<style>${STYLE}</style><div class="sheet" style="transform:${t};filter:blur(${uni(0.5, 1).toFixed(2)}px);margin:${Math.round(uni(20, 60))}px 0 0 ${Math.round(uni(0, 20))}px">${k.html}</div><div class="light" style="background:${light}"></div>${NOISE.replace("SEED", String(i))}`,
  );
  const jpg: Buffer = await page.screenshot({ type: "jpeg", quality: 72 });
  if (out) writeFileSync(`${out}/${k.name}.jpg`, jpg);
  photos.push(`data:image/jpeg;base64,${jpg.toString("base64")}`);
}
await browser.close();
if (process.env.DRY) process.exit(0);

// Read each photo REPEATS times (default 3), a few at a time: the model is not deterministic.
const REPEATS = Number(process.env.REPEATS ?? 3);
const jobs = Array.from({ length: cases.length * REPEATS }, (_, j) => ({ i: j % cases.length, run: Math.floor(j / cases.length) }));
type Res = { error?: string; eye?: string; age?: number | null; rows?: (number | null)[][] | null[]; badRows?: number; mdMismatch?: boolean; stray?: number; isHumphrey242?: boolean };
const results: { res: Res; ms: number }[] = new Array(jobs.length);
let next = 0;
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (next < jobs.length) {
      const j = next++;
      const { i } = jobs[j];
      const t0 = Date.now();
      const r = await fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: photos[i] }) });
      results[j] = { res: (await r.json()) as Res, ms: Date.now() - t0 };
    }
  }),
);

let values = 0, exact = 0, missing = 0, wrong = 0, within1 = 0, absErr = 0, extra = 0, wrongEye = 0, wrongAge = 0, badRows = 0, errors = 0, flagged = 0, perfect = 0;
const wrongButUnflagged: string[] = [];
const misreads: string[] = [];
const perPrintout = jobs.map(({ i, run }, j) => {
  const k = cases[i];
  const { res, ms } = results[j];
  if (res.error || !res.rows) {
    // A failed read counts every value as missing: the person types them all.
    const n = k.rows.flat().filter((v) => v !== null).length;
    errors++;
    values += n;
    missing += n;
    return { name: k.name, run, error: res.error ?? "no rows", seconds: +(ms / 1000).toFixed(1) };
  }
  if (res.eye !== k.eye) wrongEye++;
  if (res.age !== k.age) wrongAge++;
  badRows += res.badRows ?? 0;
  let w = 0, m = 0;
  k.rows.forEach((row, r) =>
    row.forEach((v, j) => {
      const got = res.rows?.[r]?.[j] ?? null;
      if (v === null) {
        if (got !== null) extra++;
        return;
      }
      values++;
      if (got === null) {
        missing++;
        m++;
        return;
      }
      if (got === v) exact++;
      else {
        wrong++;
        w++;
        misreads.push(`${k.name} run ${run} r${r} #${j}: ${v} read as ${got}`);
      }
      if (Math.abs(got - v) <= 1) within1++;
      absErr += Math.abs(got - v);
    }),
  );
  const flag = !!res.mdMismatch || (res.stray ?? 0) > 0 || (res.badRows ?? 0) > 0;
  if (flag) flagged++;
  if (w === 0 && m === 0 && res.eye === k.eye) perfect++;
  if ((w > 0 || res.eye !== k.eye) && !flag) wrongButUnflagged.push(k.name);
  console.log(`${k.name.padEnd(22)} eye ${res.eye} age ${res.age} wrong ${w} missing ${m} badRows ${res.badRows} stray ${res.stray} md? ${res.mdMismatch} ${(ms / 1000).toFixed(1)}s`);
  return { name: k.name, run, wrong: w, missing: m, eyeRight: res.eye === k.eye, flagged: flag, seconds: +(ms / 1000).toFixed(1) };
});
console.log(misreads.join("\n"));
const secs = results.map((r) => r.ms / 1000).sort((a, b) => a - b);
const summary = {
  generatedBy: "web/scripts/printout-eval.mts",
  what: "Synthetic Humphrey-style 24-2 printouts from real UWHVF visits (last visit, both eyes, every library profile), with a Pattern Deviation decoy, photographed in simulation. Not real printouts: no real printout is openly licensed.",
  model: "claude-sonnet-5, effort low, via /api/read-printout",
  printouts: cases.length,
  readsPerPrintout: REPEATS,
  reads: jobs.length,
  errors,
  values,
  exact,
  exactRate: +(exact / values).toFixed(4),
  within1dB: +(within1 / values).toFixed(4),
  missing,
  wrong,
  meanAbsErrorWhenRead: +(absErr / (values - missing)).toFixed(2),
  valueWhereNoTestPoint: extra,
  wrongEye,
  wrongAge,
  badRows,
  readsPerfect: perfect,
  readsFlagged: flagged,
  readsWrongButUnflagged: wrongButUnflagged.length,
  medianSeconds: +secs[Math.floor(secs.length / 2)].toFixed(1),
  maxSeconds: +secs[secs.length - 1].toFixed(1),
  misreads,
  perPrintout,
};
writeFileSync(new URL("../src/content/printout-eval.json", import.meta.url), JSON.stringify(summary, null, 1) + "\n");
console.log(JSON.stringify({ ...summary, misreads: undefined, perPrintout: undefined }, null, 1));
