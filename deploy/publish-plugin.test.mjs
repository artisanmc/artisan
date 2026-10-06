import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { needsRelease, publishPlugin, signRelease } from "./publish-plugin.mjs";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const keyPem = privateKey.export({ type: "pkcs8", format: "pem" });
const jar = Buffer.from("jar bytes");
const env = {
  API_URL: "https://api.example.test",
  PLUGIN_SIGNING_KEY: keyPem,
  PLUGIN_VERSION: "1.0.12",
  PLUGIN_JAR: "artisan.jar",
  EXPECTED_SHA: "abc123",
};
const response = (body, status = 200) => ({ ok: status < 300, status, json: async () => body });

test("la signature couvre la version et le sha256, comme le vérifient backend et plugin", () => {
  const { sha256, signature } = signRelease(jar, "1.0.12", keyPem);
  assert.equal(sha256, createHash("sha256").update(jar).digest("hex"));
  const message = Buffer.from(`artisan-plugin\n1.0.12\n${sha256}`);
  assert.ok(verify(null, message, publicKey, Buffer.from(signature, "base64")));
});

test("publie le JAR signé avec version et commit en en-têtes", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return response({ version: "1.0.12" }, 201); };
  await publishPlugin({ fetchImpl, readFile: () => jar }, env);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.example.test/api/v1/plugin-release");
  assert.equal(calls[0].init.method, "PUT");
  assert.equal(calls[0].init.headers["X-Artisan-Plugin-Version"], "1.0.12");
  assert.equal(calls[0].init.headers["X-Artisan-Plugin-Commit"], "abc123");
  assert.deepEqual(Buffer.from(calls[0].init.body), jar);
});

test("échoue bruyamment si le backend refuse", async () => {
  const fetchImpl = async () => response({ error: "invalid_signature" }, 400);
  await assert.rejects(publishPlugin({ fetchImpl, readFile: () => jar }, env), /HTTP 400/);
});

test("ne republie que si plugin/ a changé depuis la release servie", async () => {
  const served = (body, status = 200) => async () => response(body, status);
  const diff = (changed) => (from) => { assert.equal(from, "old"); return changed; };
  assert.equal(await needsRelease({ fetchImpl: served({ commit: "old" }), pluginChangedSince: diff(false) }, env), false);
  assert.equal(await needsRelease({ fetchImpl: served({ commit: "old" }), pluginChangedSince: diff(true) }, env), true);
  assert.equal(await needsRelease({ fetchImpl: served({ error: "no_release" }, 404), pluginChangedSince: diff(false) }, env), true);
});

test("le déploiement construit et publie le plugin après le backend", () => {
  const workflow = readFileSync(fileURLToPath(new URL("../.github/workflows/deploy.yml", import.meta.url)), "utf8");
  assert.match(workflow, /PLUGIN_SIGNING_KEY: \$\{\{ secrets\.PLUGIN_SIGNING_KEY \}\}/);
  assert.match(workflow, /-PartisanVersion=1\.0\.\$\{\{ github\.event\.workflow_run\.run_number \}\}/);
  assert.ok(workflow.indexOf("node deploy/coolify-deploy.mjs") < workflow.indexOf("node deploy/publish-plugin.mjs publish"));
});
