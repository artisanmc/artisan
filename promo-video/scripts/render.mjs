// Construit le bundle Remotion, lance le hub rejoué qui le sert, puis rend :
//   node scripts/render.mjs                      le montage → out/artisan-promo.mp4
//   node scripts/render.mjs still item out/item.png --frame=60
//   node scripts/render.mjs render item out/item.mp4
//   node scripts/render.mjs gifs [scène…]        les scènes de l'éditeur en GIF, sans titre → out/gifs/
//   node scripts/render.mjs clips [scène…]       les mêmes en MP4 1080p, sans titre → out/clips/
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
/** Les écrans hors éditeur : pas de GIF. */
const TITLES = ["intro", "setup", "modules", "outro"];
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

/** Rend `ids` à quatre navigateurs de front, chacun à un onglet. */
async function renderScenes(ids, file, args = []) {
  let failed = 0;
  const waiting = [...ids];
  const worker = async () => {
    for (let id = waiting.shift(); id; id = waiting.shift()) {
      const code = await run(
        ["render", origin, id, file(id), "--concurrency=1", "--log=error", ...args, ...extra],
        ["ignore", "ignore", "inherit"],
      );
      console.log(`${code ? "échec" : "rendu"} ${file(id)}`);
      failed ||= code;
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, availableParallelism()) }, worker));
  return failed;
}

let code = 0;
const scenes = read("../src/order.json");
if (command === "gifs") {
  // Les scènes jouées dans l'éditeur, sans titre : la page de vente a déjà les siens.
  const ids = rest.length > 0 ? rest : scenes.filter((id) => !TITLES.includes(id));
  mkdirSync("out/gifs", { recursive: true });
  code = await renderScenes(ids, (id) => `out/gifs/${id}.gif`, [
    "--codec=gif",
    "--every-nth-frame=3",
    "--scale=0.5",
    `--props=${JSON.stringify({ captions: false })}`,
  ]);
} else if (command === "clips") {
  // La source des bannières animées de la page de vente (website, listings/banners).
  const ids = rest.length > 0 ? rest : scenes.filter((id) => !TITLES.includes(id));
  mkdirSync("out/clips", { recursive: true });
  code = await renderScenes(ids, (id) => `out/clips/${id}.mp4`, [
    "--crf=12",
    `--props=${JSON.stringify({ captions: false })}`,
  ]);
} else if (command) {
  code = await run([command, origin, ...rest, ...extra]);
} else {
  mkdirSync("out/scenes", { recursive: true });
  code = await renderScenes(scenes, (id) => `out/scenes/${id}.mp4`);
  if (!code) {
    writeFileSync("out/scenes/list.txt", scenes.map((id) => `file '${id}.mp4'\n`).join(""));
    code = await run(["ffmpeg", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", "out/scenes/list.txt", "-c", "copy", "-movflags", "+faststart", "out/artisan-promo.mp4"]);
    if (!code) console.log("montage → out/artisan-promo.mp4");
  }
}
hub.kill();
process.exit(code);
