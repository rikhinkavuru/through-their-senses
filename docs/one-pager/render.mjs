// Render the one-page PDF, filling validation numbers from validation/results.json.
// Usage: node docs/one-pager/render.mjs
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require(`${process.env.HOME}/.claude/skills/gstack/node_modules/playwright`);
const here = dirname(fileURLToPath(import.meta.url));
let html = readFileSync(join(here, "one-pager.html"), "utf8");
const resPath = join(here, "../../validation/results.json");
const f1 = (x) => (typeof x === "number" ? x.toFixed(1) : "–");
const f2 = (x) => (typeof x === "number" ? x.toFixed(2) : "–");
if (existsSync(resPath)) {
  const r = JSON.parse(readFileSync(resPath, "utf8"));
  const base = r.production_base_en?.cal ?? r.ablations?.base_en_full?.cal ?? r.base_en_cal;
  html = html
    .replace("{{OURS_RMSE}}", f1(r.ours_cal?.rmse)).replace("{{OURS_R}}", f2(r.ours_cal?.pearson))
    .replace("{{HASPI_RMSE}}", f1(r.haspi_cal?.rmse)).replace("{{HASPI_R}}", f2(r.haspi_cal?.pearson))
    .replace("{{BASE_RMSE}}", f1(base?.rmse)).replace("{{BASE_R}}", f2(base?.pearson));
}
const tmp = join(here, "_render.html");
writeFileSync(tmp, html);
const b = await chromium.launch();
const p = await b.newPage();
await p.goto("file://" + tmp, { waitUntil: "networkidle" });
await p.pdf({ path: join(here, "through-their-senses-one-pager.pdf"), format: "Letter", printBackground: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } });
await p.setViewportSize({ width: 816, height: 1056 });
await p.screenshot({ path: join(here, "preview.png"), fullPage: true });
const pages = await p.evaluate(() => Math.ceil(document.body.scrollHeight / 1056));
console.log("pages (approx):", pages);
await b.close();
