// Local screenshot helper with software WebGL (SwiftShader), for checking the
// renderer without a GPU. Usage: node scripts/shot.mjs <url> <out.png> [WxH] [waitMs] [jsBeforeShot]
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pw = process.env.PLAYWRIGHT_PATH ?? `${process.env.HOME}/.claude/skills/gstack/node_modules/playwright`;
const { chromium } = require(pw);
const [url, out, size = "900x800", wait = "3000", js = ""] = process.argv.slice(2);
const [width, height] = size.split("x").map(Number);
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
const logs = [];
page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && logs.push(`${m.type()}: ${m.text()}`));
page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
await page.goto(url, { waitUntil: "networkidle" });
if (js) await page.evaluate(js);
await page.waitForTimeout(Number(wait));
await page.screenshot({ path: out });
console.log(JSON.stringify({ gl2: await page.evaluate(() => !!document.createElement("canvas").getContext("webgl2")), logs: logs.slice(0, 10) }));
await browser.close();
