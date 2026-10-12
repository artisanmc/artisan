import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildHeaders,
  deployProduction,
  fetchWithTimeout,
  pinApplicationRevision,
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
  MARKETING_HEALTH_URL: "https://artisanmc.net/",
  EXPECTED_SHA: "0123456789abcdef0123456789abcdef01234567",
};

const response = (body, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  json: async () => body,
});

test("deploy workflow ships only the current successful CI SHA of main or staging", () => {
  const workflowPath = fileURLToPath(new URL("../.github/workflows/deploy.yml", import.meta.url));
  const workflow = readFileSync(workflowPath, "utf8");

  assert.match(workflow, /^name: Deploy$/m);
  assert.match(workflow, /^\s{2}workflow_run:$/m);
  assert.match(workflow, /^\s{4}workflows: \[CI\]$/m);
  assert.match(workflow, /^\s{4}branches: \[main, staging\]$/m);
  assert.match(workflow, /^\s{4}types: \[completed\]$/m);
  assert.match(workflow, /^\s{2}contents: read$/m);
  assert.match(workflow, /^\s{2}group: deploy-\$\{\{ github\.event\.workflow_run\.head_branch \}\}$/m);
  assert.match(workflow, /^\s{2}cancel-in-progress: false$/m);
  assert.match(workflow, /^\s{4}if: github\.event\.workflow_run\.conclusion == 'success' && github\.event\.workflow_run\.event == 'push'$/m);
  assert.match(workflow, /^\s{4}environment: \$\{\{ github\.event\.workflow_run\.head_branch == 'staging' && 'staging' \|\| 'production' \}\}$/m);
  assert.match(workflow, /^\s{8}uses: actions\/checkout@v5$/m);
  assert.match(workflow, /^\s{10}ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}$/m);
  assert.match(workflow, /^\s{8}uses: actions\/setup-node@v5$/m);
  assert.match(workflow, /^\s{10}node-version: 22$/m);
  assert.match(workflow, /git ls-remote origin "refs\/heads\/\$BRANCH"/);
  assert.match(workflow, /if \[ "\$CURRENT_SHA" != "\$EXPECTED_SHA" \]; then/);
  assert.match(workflow, /node deploy\/coolify-deploy\.mjs/);
  assert.match(workflow, /^\s{4}timeout-minutes: 30$/m);
  assert.match(workflow, /EXPECTED_SHA: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
  assert.match(workflow, /'https:\/\/api\.artisanmc\.net'/);
  assert.match(workflow, /'https:\/\/editor\.artisanmc\.net'/);
  assert.match(workflow, /API_HEALTH_URL: \$\{\{ env\.API_URL \}\}\/health/);
  assert.match(workflow, /EDITOR_HEALTH_URL: \$\{\{ env\.EDITOR_URL \}\}\/health/);
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
    if (url.includes("/api/v1/deployments/")) {
      return response({ status: "finished", commit: env.EXPECTED_SHA });
    }
    return response({});
  };

  await deployProduction({ fetchImpl, sleep: async () => {} }, env);

  assert.deepEqual(calls, [
    ["https://coolify.example.test/api/v1/applications/backend%20uuid", "PATCH"],
    ["https://coolify.example.test/api/v1/deploy?uuid=backend%20uuid&force=false", "POST"],
    ["https://coolify.example.test/api/v1/deployments/backend-deployment", "GET"],
    ["https://api.artisanmc.net/health", "GET"],
    ["https://coolify.example.test/api/v1/applications/editor%20uuid", "PATCH"],
    ["https://coolify.example.test/api/v1/deploy?uuid=editor%20uuid&force=false", "POST"],
    ["https://coolify.example.test/api/v1/deployments/editor-deployment", "GET"],
    ["https://editor.artisanmc.net/health", "GET"],
    ["https://artisanmc.net/", "GET"],
  ]);
});

test("pinApplicationRevision sends the validated SHA to Coolify", async () => {
  let request;
  await pinApplicationRevision(async (url, options) => {
    request = { url, options };
    return response({ message: "updated" });
  }, env, "backend uuid");

  assert.equal(request.url, "https://coolify.example.test/api/v1/applications/backend%20uuid");
  assert.equal(request.options.method, "PATCH");
  assert.equal(request.options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(request.options.body), { git_commit_sha: env.EXPECTED_SHA });
});

test("waitForDeployment rejects a deployment of another commit", async () => {
  await assert.rejects(
    waitForDeployment(
      async () => response({ status: "finished", commit: "f".repeat(40) }),
      env,
      "deploy-123",
      async () => {},
    ),
    /unexpected commit/i,
  );
});

test("fetchWithTimeout aborts a stalled request", async () => {
  const stalledFetch = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason));
  });

  await assert.rejects(fetchWithTimeout(stalledFetch, "https://example.test", {}, 5), /timed out/i);
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
    return response({ status: "finished", commit: env.EXPECTED_SHA });
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
  const sleepDelays = [];
  await waitForDeployment(
    async () => response({ status: statuses.shift(), commit: env.EXPECTED_SHA }),
    env,
    "deploy-123",
    async (delay) => { sleepDelays.push(delay); },
  );
  assert.deepEqual(sleepDelays, [10_000, 10_000]);
});

test("waitForHealth retries non-2xx and network errors before success", async () => {
  const outcomes = [response({}, { ok: false, status: 503 }), new Error("network down"), response({})];
  const sleepDelays = [];
  await waitForHealth(async () => {
    const outcome = outcomes.shift();
    if (outcome instanceof Error) throw outcome;
    return outcome;
  }, env.API_HEALTH_URL, async (delay) => { sleepDelays.push(delay); });
  assert.deepEqual(sleepDelays, [5_000, 5_000]);
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

test("deployProduction never triggers editor after backend health failure", async () => {
  const urls = [];
  await assert.rejects(
    deployProduction({
      fetchImpl: async (url) => {
        urls.push(url);
        if (url.includes("/api/v1/applications/")) return response({});
        if (url.includes("/api/v1/deploy?")) {
          return response({ deployments: [{ deployment_uuid: "backend-deployment" }] });
        }
        if (url.includes("/api/v1/deployments/")) {
          return response({ status: "finished", commit: env.EXPECTED_SHA });
        }
        return response({}, { ok: false, status: 503 });
      },
      sleep: async () => {},
    }, env),
    (error) => error.message.includes(env.API_HEALTH_URL),
  );
  assert.equal(urls.some((url) => url.includes("editor%20uuid")), false);
});

test("main-module failure is nonzero and does not expose secrets", () => {
  const childEnv = {
    ...process.env,
    ...env,
    COOLIFY_API_TOKEN: "cli-secret-token",
    CF_ACCESS_CLIENT_SECRET: "cli-access-secret",
    API_HEALTH_URL: "",
  };
  const scriptPath = fileURLToPath(new URL("./coolify-deploy.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [scriptPath], {
    env: childEnv,
    encoding: "utf8",
    timeout: 5_000,
  });
  const output = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0);
  assert.equal(output.includes(childEnv.COOLIFY_API_TOKEN), false);
  assert.equal(output.includes(childEnv.CF_ACCESS_CLIENT_SECRET), false);
  assert.match(output, /deployment failed/i);
});
