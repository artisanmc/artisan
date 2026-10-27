// Remplace le backend pour la vidéo : sert `/api/v1/textures/<version>/<path>`
// depuis .cache/ (scripts/fetch-assets.mjs), avec la même résolution que
// backend/src/lib/mcAssets.ts (`<path>.png`, vanilla puis icônes 3D).
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, normalize, resolve } from "node:path";
import config from "./texture-server.json" with { type: "json" };

export const TEXTURE_PORT = config.port;
const cache = resolve(import.meta.dirname, "..", ".cache");

export function startTextureServer(port = TEXTURE_PORT) {
  const server = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    const match = /^\/api\/v1\/textures\/([\w.]+)\/(.+)$/.exec(decodeURIComponent(req.url.split("?")[0]));
    if (!match) return res.writeHead(404).end();
    const [, version, rest] = match;
    const rel = normalize(`${rest}.png`);
    if (rel.startsWith("..")) return res.writeHead(404).end();
    const base = rel.startsWith("icons/")
      ? join(cache, version, "mc-assets", version, "textures")
      : join(cache, version, "assets", "minecraft", "textures");
    try {
      const bytes = await readFile(join(base, rel));
      res.writeHead(200, { "Content-Type": "image/png" }).end(bytes);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((ok) => server.listen(port, () => ok(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await startTextureServer();
  console.log(`Textures sur http://localhost:${TEXTURE_PORT}`);
}
