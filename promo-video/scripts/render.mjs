// Construit le bundle Remotion, lance le hub rejoué qui le sert, puis rend :
//   node scripts/render.mjs                      le montage → out/artisan-promo.mp4
//   node scripts/render.mjs still item out/item.png --frame=60
//   node scripts/render.mjs render item out/item.mp4
// Le montage rend chaque scène de src/order.json dans son propre navigateur, à un seul onglet, puis
// colle les fichiers : une scène modifie l'éditeur (saisie, brouillon), elle doit donc partir d'un
// éditeur neuf et jouer ses images dans l'ordre.
// HUB_RECORD et HUB_COOKIE (voir hub.mjs) enregistrent les lectures encore inconnues.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";

const read = (file) => JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8"));
const { port } = read("./hub.json");
const origin = `http://localhost:${port}`;
const [command, ...rest] = process.argv.slice(2);
const extra = (process.env.REMOTION_ARGS ?? "").split(" ").filter(Boolean);

const run = (args, stdio = "inherit") =>
  new Promise((resolve) => spawn("npx", ["remotion", ...args], { stdio }).on("exit", (code) => resolve(code ?? 1)));

if (!process.env.SKIP_BUNDLE) {
  const bundle = spawnSync("npx", ["remotion", "bundle", "src/index.ts", "--out-dir=build", "--log=error"], {
    stdio: "inherit",
  });
  if (bundle.status !== 0) process.exit(bundle.status ?? 1);
}
const hub = spawn("node", ["scripts/hub.mjs"], { stdio: "inherit" });
await new Promise((r) => setTimeout(r, 400));

let code = 0;
if (command) {
  code = await run([command, origin, ...rest, ...extra]);
} else {
  const scenes = read("../src/order.json");
  mkdirSync("out/scenes", { recursive: true });
  const waiting = [...scenes];
  const worker = async () => {
    for (let id = waiting.shift(); id; id = waiting.shift()) {
      const failed = await run(
        ["render", origin, id, `out/scenes/${id}.mp4`, "--concurrency=1", "--log=error", ...extra],
        ["ignore", "ignore", "inherit"],
      );
      console.log(`${failed ? "échec" : "rendu"} ${id}`);
      code ||= failed;
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, availableParallelism()) }, worker));
  if (!code) {
    writeFileSync("out/scenes/list.txt", scenes.map((id) => `file '${id}.mp4'\n`).join(""));
    code = await run(["ffmpeg", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", "out/scenes/list.txt", "-c", "copy", "-movflags", "+faststart", "out/artisan-promo.mp4"]);
    if (!code) console.log("montage → out/artisan-promo.mp4");
  }
}
hub.kill();
process.exit(code);
