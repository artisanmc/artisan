import { execFileSync } from "node:child_process";
import { createHash, sign } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Publie le JAR du plugin sur le backend, signé Ed25519. Backend et plugin
// vérifient la signature avec la même clé publique (lib/pluginRelease.ts,
// update/PluginUpdater.kt) : la clé privée ne vit que dans le secret GitHub.

export function signRelease(bytes, version, keyPem) {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const signature = sign(null, Buffer.from(`artisan-plugin\n${version}\n${sha256}`), keyPem).toString("base64");
  return { sha256, signature };
}

/** Un déploiement qui ne touche pas plugin/ ne doit pas proposer de « mise à jour » aux serveurs. */
export async function needsRelease({ fetchImpl, pluginChangedSince }, env) {
  const res = await fetchImpl(`${env.API_URL}/api/v1/plugin-release`);
  if (!res.ok) return true;
  const { commit } = await res.json();
  return !commit || pluginChangedSince(commit);
}

export async function publishPlugin({ fetchImpl, readFile = readFileSync }, env) {
  const bytes = readFile(env.PLUGIN_JAR);
  const { signature } = signRelease(bytes, env.PLUGIN_VERSION, env.PLUGIN_SIGNING_KEY);
  const res = await fetchImpl(`${env.API_URL}/api/v1/plugin-release`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/java-archive",
      "X-Artisan-Plugin-Version": env.PLUGIN_VERSION,
      "X-Artisan-Plugin-Signature": signature,
      "X-Artisan-Plugin-Commit": env.EXPECTED_SHA,
    },
    body: bytes,
  });
  if (!res.ok) throw new Error(`Plugin release upload failed with HTTP ${res.status}: ${JSON.stringify(await res.json().catch(() => null))}`);
}

function gitPluginChangedSince(commit) {
  try {
    execFileSync("git", ["diff", "--quiet", commit, "HEAD", "--", "plugin"]);
    return false;
  } catch {
    return true; // diff non vide, ou commit inconnu : on republie.
  }
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  const run = process.argv[2] === "check"
    ? needsRelease({ fetchImpl: fetch, pluginChangedSince: gitPluginChangedSince }, process.env).then((needed) => {
        console.log(needed ? "Plugin changed: a new release will be published." : "Plugin unchanged: no release.");
        appendFileSync(process.env.GITHUB_OUTPUT, `needed=${needed}\n`);
      })
    : publishPlugin({ fetchImpl: fetch }, process.env).then(() => console.log(`Published plugin ${process.env.PLUGIN_VERSION}.`));
  run.catch((error) => {
    console.error("Plugin release failed:", error?.message ?? error);
    process.exitCode = 1;
  });
}
