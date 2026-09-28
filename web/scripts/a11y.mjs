// Accessibility audit with axe-core on the main pages. Usage: node scripts/a11y.mjs [baseUrl]
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require(`${process.env.HOME}/.claude/skills/gstack/node_modules/playwright`);
const axe = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const base = process.argv[2] ?? "http://localhost:3100";
const pages = ["/", "/method", "/start", "/p/example", "/p/example/see", "/p/example/hear", "/p/example/walk", "/p/example/sit", "/p/example/guide"];
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
for (const path of pages) {
  await p.goto(base + path, { waitUntil: "networkidle" });
  await p.waitForTimeout(path.includes("see") || path.includes("walk") ? 6000 : 1200);
  await p.addScriptTag({ content: axe });
  const res = await p.evaluate(async () => {
    // @ts-ignore
    const r = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, help: v.help, target: v.nodes.slice(0, 3).map((n) => n.target.join(" ")) }));
  });
  console.log(`\n${path}: ${res.length} violation types`);
  for (const v of res) console.log(`  [${v.impact}] ${v.id} x${v.n}: ${v.help} | ${v.target.join(" ; ")}`);
}
await b.close();
