// Lance le serveur de textures puis la CLI Remotion avec les arguments reçus :
//   node scripts/render.mjs render Promo out/artisan-promo.mp4
import { spawn } from "node:child_process";
import { startTextureServer } from "./texture-server.mjs";

const server = await startTextureServer();
const child = spawn("npx", ["remotion", ...process.argv.slice(2)], { stdio: "inherit" });
child.on("exit", (code) => {
  server.close();
  process.exit(code ?? 1);
});
