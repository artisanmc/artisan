import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildHeaders,
  deployProduction,
  triggerDeployment,
  waitForDeployment,
  waitForHealth,
} from "./coolify-deploy.mjs";

const env = {
  COOLIFY_BASE_URL: "https://coolify.example.test",
  COOLIFY_API_TOKEN: "coolify-secret-token",
  COOLIFY_BACKEND_UUID: "backend uuid",
  COOLIFY_EDITOR_UUID: "editor uuid",
  CF_ACCESS_CLIENT_ID: "access-client-id",
  CF_ACCESS_CLIENT_SECRET: "access-client-secret",
  API_HEALTH_URL: "https://api.artisanmc.net/health",
  EDITOR_HEALTH_URL: "https://editor.artisanmc.net/health",
};

const response = (body, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  json: async () => body,
});

test("buildHeaders returns exactly the Coolify and Cloudflare headers", () => {
  assert.deepEqual(buildHeaders(env), {
    Authorization: "Bearer coolify-secret-token",
    "CF-Access-Client-Id": "access-client-id",
    "CF-Access-Client-Secret": "access-client-secret",
    Accept: "application/json",
  });
});

test("deployProduction validates every required variable before fetching", async () => {
  let fetches = 0;
  const missingEnv = Object.fromEntries(Object.keys(env).map((key) => [key, ""]));

  await assert.rejects(
    deployProduction({ fetchImpl: async () => { fetches += 1; } }, missingEnv),
    (error) => Object.keys(env).every((key) => error.message.includes(key)),
  );
  assert.equal(fetches, 0);
});

test("deployProduction strictly deploys and health-checks backend before editor", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push([url, options.method ?? "GET"]);
    if (url.includes("/api/v1/deploy?")) {
      const uuid = url.includes("backend%20uuid") ? "backend-deployment" : "editor-deployment";
      return response({ deployments: [{ deployment_uuid: uuid }] });
    }
    if (url.includes("/api/v1/deployments/")) return response({ status: "finished" });
    return response({});
  };

  await deployProduction({ fetchImpl, sleep: async () => {} }, env);

  assert.deepEqual(calls, [
    ["https://coolify.example.test/api/v1/deploy?uuid=backend%20uuid&force=false", "POST"],
    ["https://coolify.example.test/api/v1/deployments/backend-deployment", "GET"],
    ["https://api.artisanmc.net/health", "GET"],
    ["https://coolify.example.test/api/v1/deploy?uuid=editor%20uuid&force=false", "POST"],
    ["https://coolify.example.test/api/v1/deployments/editor-deployment", "GET"],
    ["https://editor.artisanmc.net/health", "GET"],
  ]);
});

test("triggerDeployment rejects non-2xx responses", async () => {
  await assert.rejects(
    triggerDeployment(async () => response({}, { ok: false, status: 401 }), env, "backend"),
    /HTTP 401/,
  );
});

test("triggerDeployment rejects a response without deployment UUID", async () => {
  await assert.rejects(
    triggerDeployment(async () => response({ deployments: [] }), env, "backend"),
    /Coolify did not return a deployment UUID/,
  );
});

test("waitForDeployment accepts finished and encodes its UUID", async () => {
  let requestedUrl;
  await waitForDeployment(async (url) => {
    requestedUrl = url;
    return response({ status: "finished" });
  }, env, "deployment / one", async () => {});
  assert.equal(requestedUrl, "https://coolify.example.test/api/v1/deployments/deployment%20%2F%20one");
});

for (const status of ["failed", "cancelled"]) {
  test(`waitForDeployment rejects terminal ${status} status`, async () => {
    await assert.rejects(
      waitForDeployment(async () => response({ status }), env, "deploy-123", async () => {}),
      (error) => error.message.includes("deploy-123") && error.message.includes(status),
    );
  });
}

test("waitForDeployment explicitly rejects non-2xx polls", async () => {
  await assert.rejects(
    waitForDeployment(async () => response({}, { ok: false, status: 503 }), env, "deploy-123", async () => {}),
    /HTTP 503/,
  );
});

test("waitForDeployment retries pending states then succeeds", async () => {
  const statuses = ["queued", "in_progress", "finished"];
  let sleeps = 0;
  await waitForDeployment(
    async () => response({ status: statuses.shift() }),
    env,
    "deploy-123",
    async () => { sleeps += 1; },
  );
  assert.equal(sleeps, 2);
});

test("waitForHealth retries non-2xx and network errors before success", async () => {
  const outcomes = [response({}, { ok: false, status: 503 }), new Error("network down"), response({})];
  let sleeps = 0;
  await waitForHealth(async () => {
    const outcome = outcomes.shift();
    if (outcome instanceof Error) throw outcome;
    return outcome;
  }, env.API_HEALTH_URL, async () => { sleeps += 1; });
  assert.equal(sleeps, 2);
});

test("waitForDeployment times out after exactly 60 polls", async () => {
  let polls = 0;
  await assert.rejects(
    waitForDeployment(async () => {
      polls += 1;
      return response({ status: "in_progress" });
    }, env, "deploy-123", async () => {}),
    /timed out.*deploy-123/i,
  );
  assert.equal(polls, 60);
});

test("waitForHealth times out after exactly 30 polls and names the URL", async () => {
  let polls = 0;
  await assert.rejects(
    waitForHealth(async () => {
      polls += 1;
      return response({}, { ok: false, status: 503 });
    }, env.EDITOR_HEALTH_URL, async () => {}),
    (error) => error.message.includes(env.EDITOR_HEALTH_URL),
  );
  assert.equal(polls, 30);
});

test("deployProduction never triggers editor after backend failure", async () => {
  const urls = [];
  await assert.rejects(
    deployProduction({
      fetchImpl: async (url) => {
        urls.push(url);
        if (url.includes("/api/v1/deploy?")) return response({ deployments: [{ deployment_uuid: "backend-deployment" }] });
        return response({ status: "failed" });
      },
      sleep: async () => {},
    }, env),
    /failed/,
  );
  assert.equal(urls.some((url) => url.includes("editor%20uuid")), false);
});

test("main-module failure is nonzero and does not expose secrets", () => {
  const childEnv = { ...process.env, ...env, COOLIFY_BASE_URL: "http://127.0.0.1:1" };
  const scriptPath = fileURLToPath(new URL("./coolify-deploy.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [scriptPath], {
    env: childEnv,
    encoding: "utf8",
    timeout: 5_000,
  });
  const output = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0);
  assert.equal(output.includes(env.COOLIFY_API_TOKEN), false);
  assert.equal(output.includes(env.CF_ACCESS_CLIENT_SECRET), false);
  assert.match(output, /deployment failed/i);
});
