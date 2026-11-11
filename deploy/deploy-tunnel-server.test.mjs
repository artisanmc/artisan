import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { deployTunnelServer, tunnelServerUnchanged } from "./deploy-tunnel-server.mjs";

const env = {
  COOLIFY_BASE_URL: "https://coolify.example.test",
  COOLIFY_API_TOKEN: "coolify-secret-token",
  COOLIFY_TUNNEL_SERVER_UUID: "tunnel uuid",
  CF_ACCESS_CLIENT_ID: "access-client-id",
  CF_ACCESS_CLIENT_SECRET: "access-client-secret",
  TUNNEL_HEALTH_URL: "https://connect.artisanmc.app/health",
  EXPECTED_SHA: "0123456789abcdef0123456789abcdef01234567",
};
const previous = "a".repeat(40);

const response = (body) => ({ ok: true, status: 200, json: async () => body });

function coolify(calls) {
  return async (url, options = {}) => {
    calls.push([url, options.method ?? "GET", options.body]);
    if (url.endsWith("/applications/tunnel%20uuid") && !options.method) {
      return response({ git_commit_sha: previous });
    }
    if (url.includes("/api/v1/deploy?")) return response({ deployments: [{ deployment_uuid: "d1" }] });
    if (url.includes("/api/v1/deployments/")) return response({ status: "finished", commit: env.EXPECTED_SHA });
    return response({});
  };
}

test("the tunnel workflow deploys after the plugin tests pass on current main", () => {
  const workflow = readFileSync(
    fileURLToPath(new URL("../.github/workflows/deploy-tunnel.yml", import.meta.url)),
    "utf8",
  );
  assert.match(workflow, /^\s{4}workflows: \[Plugin\]$/m);
  assert.match(workflow, /^\s{4}branches: \[main\]$/m);
  assert.match(workflow, /^\s{4}if: github\.event\.workflow_run\.conclusion == 'success'$/m);
  assert.match(workflow, /^\s{2}group: production$/m);
  assert.match(workflow, /^\s{10}fetch-depth: 0$/m);
  assert.match(workflow, /git ls-remote origin refs\/heads\/main/);
  assert.match(workflow, /COOLIFY_TUNNEL_SERVER_UUID: \$\{\{ vars\.COOLIFY_TUNNEL_SERVER_UUID \}\}/);
  assert.match(workflow, /node deploy\/deploy-tunnel-server\.mjs/);
});

test("a changed tunnel server is pinned on main, deployed, then health-checked", async () => {
  const calls = [];
  const deployed = await deployTunnelServer(
    { fetchImpl: coolify(calls), sleep: async () => {}, unchanged: () => false, log: () => {} },
    env,
  );

  assert.equal(deployed, true);
  assert.deepEqual(calls.map(([url, method]) => [url, method]), [
    ["https://coolify.example.test/api/v1/applications/tunnel%20uuid", "GET"],
    ["https://coolify.example.test/api/v1/applications/tunnel%20uuid", "PATCH"],
    ["https://coolify.example.test/api/v1/deploy?uuid=tunnel%20uuid&force=false", "POST"],
    ["https://coolify.example.test/api/v1/deployments/d1", "GET"],
    ["https://connect.artisanmc.app/health", "GET"],
  ]);
  assert.deepEqual(JSON.parse(calls[1][2]), { git_branch: "main", git_commit_sha: env.EXPECTED_SHA });
});

test("an unchanged tunnel server is left running", async () => {
  const calls = [];
  let compared;
  const deployed = await deployTunnelServer(
    {
      fetchImpl: coolify(calls),
      unchanged: (from, to) => { compared = [from, to]; return true; },
      log: () => {},
    },
    env,
  );

  assert.equal(deployed, false);
  assert.deepEqual(compared, [previous, env.EXPECTED_SHA]);
  assert.equal(calls.length, 1);
});

test("a revision that is not a commit (HEAD, empty) counts as changed", () => {
  assert.equal(tunnelServerUnchanged("HEAD", env.EXPECTED_SHA), false);
  assert.equal(tunnelServerUnchanged(undefined, env.EXPECTED_SHA), false);
});

test("missing variables are reported before any request", async () => {
  let fetches = 0;
  await assert.rejects(
    deployTunnelServer({ fetchImpl: async () => { fetches += 1; } }, { ...env, COOLIFY_TUNNEL_SERVER_UUID: "" }),
    /COOLIFY_TUNNEL_SERVER_UUID/,
  );
  assert.equal(fetches, 0);
});
