// GPU test of the field renderer in headless Chromium (SwiftShader). Needs `npm run dev`.
// Usage: node scripts/renderer-test.mjs [baseUrl]
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(`${process.env.HOME}/.claude/skills/gstack/node_modules/playwright`);
const base = process.argv[2] ?? "http://localhost:3100";
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const p = await b.newPage();
await p.goto(`${base}/dev/renderer`, { waitUntil: "networkidle" });
await p.waitForFunction(() => window.__rendererTest, null, { timeout: 60000 });
const r = await p.evaluate(() => window.__rendererTest);
console.log(JSON.stringify({ pass: r.pass, checks: r.checks, identityErr: r.identityErr, deepFraction: r.deepFraction, meanDrift: r.meanDrift, levels: r.levels.map((l) => [l.td, +l.rms.toFixed(4), +l.detail.toFixed(4)]), glare: r.glarePoints }, null, 1));
await b.close();
process.exit(r.pass ? 0 : 1);
