// Devpost gallery screenshots at 5:3 (1500x900 CSS px, 2x), with software WebGL.
// Usage: node scripts/gallery.mjs <baseUrl> <outDir>
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(`${process.env.HOME}/.claude/skills/gstack/node_modules/playwright`);
const [base = "http://localhost:3100", out = "../docs/gallery"] = process.argv.slice(2);
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await b.newContext({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
const shot = async (name) => { await p.screenshot({ path: `${out}/${name}.png` }); console.log("saved", name); };
const only = process.env.ONLY; // e.g. ONLY=hear to regenerate one shot
const want = (key) => !only || only.split(",").includes(key);

if (want("see")) {
await p.goto(`${base}/p/example/see?scene=hallway&wipe=0.5`, { waitUntil: "networkidle" });
await p.waitForTimeout(12000);
await shot("1-see-hallway");
}

if (want("night")) {
await p.goto(`${base}/p/example/see?scene=stairs&wipe=0.5&night=1`, { waitUntil: "networkidle" });
await p.waitForTimeout(12000);
await shot("2-see-stairs-dim");
}

if (want("hear")) {
await p.goto(`${base}/p/example/hear`, { waitUntil: "networkidle" });
await p.getByRole("button", { name: /fifteen past six/ }).click();
await p.getByText(/caught/).waitFor({ timeout: 120000 });
await p.getByText("What was said").evaluate((e) => e.scrollIntoView({ block: "start" }));
await p.evaluate(() => window.scrollBy(0, -32));
await p.waitForTimeout(800);
await shot("3-hear-result");
}

if (want("walk")) {
await p.goto(`${base}/p/example/walk`, { waitUntil: "networkidle" });
await p.waitForTimeout(9000);
await p.getByRole("button", { name: "Check this spot" }).click();
await p.getByRole("heading", { name: /to check|Nothing found/ }).waitFor({ timeout: 180000 });
await p.waitForTimeout(1500);
await shot("4-walk-stairs");
}

if (want("about")) {
await p.goto(`${base}/p/example`, { waitUntil: "networkidle" });
await p.waitForTimeout(1500);
await p.getByRole("heading", { name: "Vision" }).scrollIntoViewIfNeeded();
await p.evaluate(() => window.scrollBy(0, -40));
await shot("5-about-field");
}

if (want("sit")) {
await p.goto(`${base}/p/example/sit`, { waitUntil: "networkidle" });
await p.waitForTimeout(1200);
await shot("6-sit");
}

if (want("guide")) {
await p.goto(`${base}/p/example/guide`, { waitUntil: "networkidle" });
await p.waitForTimeout(1200);
await shot("7-guide");
}

await b.close();
