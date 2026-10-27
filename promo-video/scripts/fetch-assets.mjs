// Télécharge les textures que l'éditeur demande au backend (`/api/v1/textures/...`),
// servies ensuite par scripts/texture-server.mjs pendant le rendu.
// Sources : le jar client Mojang (comme backend/src/lib/mcAssets.ts) et les
// icônes 3D committées dans backend/assets-seed/.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const VERSION = "1.21.4";
const root = resolve(import.meta.dirname, "..");
const cache = join(root, ".cache", VERSION);

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

if (!existsSync(join(cache, "assets"))) {
  mkdirSync(cache, { recursive: true });
  const manifest = await (await fetch("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json")).json();
  const entry = manifest.versions.find((v) => v.id === VERSION);
  const meta = await (await fetch(entry.url)).json();
  const jar = join(cache, "client.jar");
  console.log(`Téléchargement du jar client ${VERSION}…`);
  await download(meta.downloads.client.url, jar);
  execFileSync("unzip", ["-q", "-o", jar, "assets/minecraft/textures/*", "-d", cache]);
  execFileSync("unzip", ["-q", "-o", join(root, "../backend/assets-seed", `icons-${VERSION}.zip`), "-d", cache]);
  rmSync(jar);
}

console.log(`Textures prêtes dans ${cache}`);
