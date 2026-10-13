import { pathToFileURL } from "node:url";

const REQUIRED_ENV_KEYS = [
  "COOLIFY_BASE_URL",
  "COOLIFY_API_TOKEN",
  "COOLIFY_EDITOR_UUID",
  "CF_ACCESS_CLIENT_ID",
  "CF_ACCESS_CLIENT_SECRET",
  "MARKETING_HEALTH_URL",
  "EXPECTED_SHA",
];

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function buildHeaders(env) {
  return {
    Authorization: `Bearer ${env.COOLIFY_API_TOKEN}`,
    "CF-Access-Client-Id": env.CF_ACCESS_CLIENT_ID,
    "CF-Access-Client-Secret": env.CF_ACCESS_CLIENT_SECRET,
    Accept: "application/json",
  };
}

export async function fetchWithTimeout(fetchImpl, url, options = {}, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Request timed out after ${timeoutMs} ms`)),
    timeoutMs,
  );
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function pinApplicationRevision(fetchImpl, config, resourceUuid) {
  const url = `${config.COOLIFY_BASE_URL}/api/v1/applications/${encodeURIComponent(resourceUuid)}`;
  const response = await fetchWithTimeout(fetchImpl, url, {
    method: "PATCH",
    headers: { ...buildHeaders(config), "Content-Type": "application/json" },
    body: JSON.stringify({ git_commit_sha: config.EXPECTED_SHA }),
  });
  if (!response.ok) {
    throw new Error(`Coolify revision pin failed with HTTP ${response.status}`);
  }
}

export async function triggerDeployment(fetchImpl, config, resourceUuid) {
  const url = `${config.COOLIFY_BASE_URL}/api/v1/deploy?uuid=${encodeURIComponent(resourceUuid)}&force=false`;
  const response = await fetchWithTimeout(fetchImpl, url, {
    method: "POST",
    headers: buildHeaders(config),
  });

  if (!response.ok) {
    throw new Error(`Coolify deployment trigger failed with HTTP ${response.status}`);
  }

  const body = await response.json();
  const deploymentUuid = body.deployments?.[0]?.deployment_uuid;
  if (!deploymentUuid) {
    throw new Error("Coolify did not return a deployment UUID");
  }
  return deploymentUuid;
}

export async function waitForDeployment(fetchImpl, config, deploymentUuid, sleep = defaultSleep) {
  const url = `${config.COOLIFY_BASE_URL}/api/v1/deployments/${encodeURIComponent(deploymentUuid)}`;

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await fetchWithTimeout(fetchImpl, url, { headers: buildHeaders(config) });
    if (!response.ok) {
      throw new Error(`Coolify deployment poll failed with HTTP ${response.status}`);
    }

    const { status, commit } = await response.json();
    if (status === "finished") {
      if (commit !== config.EXPECTED_SHA) {
        throw new Error(`Deployment ${deploymentUuid} finished with unexpected commit ${commit ?? "(missing)"}`);
      }
      return;
    }
    if (status === "failed" || status === "cancelled") {
      throw new Error(`Deployment ${deploymentUuid} ended with status ${status}`);
    }
    if (attempt < 59) await sleep(10_000);
  }

  throw new Error(`Timed out waiting for deployment ${deploymentUuid}`);
}

export async function waitForHealth(fetchImpl, url, sleep = defaultSleep) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetchWithTimeout(fetchImpl, url);
      if (response.ok) return;
    } catch {
      // A temporarily unreachable service is retried like an unhealthy response.
    }
    if (attempt < 29) await sleep(5_000);
  }

  throw new Error(`Timed out waiting for health endpoint ${url}`);
}

export async function deployProduction(deps, env) {
  const missing = REQUIRED_ENV_KEYS.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  // Une seule ressource : la vitrine artisanmc.net (landing + wiki), construite par editor/Dockerfile.
  const { fetchImpl, sleep = defaultSleep } = deps;
  await pinApplicationRevision(fetchImpl, env, env.COOLIFY_EDITOR_UUID);
  const deployment = await triggerDeployment(fetchImpl, env, env.COOLIFY_EDITOR_UUID);
  await waitForDeployment(fetchImpl, env, deployment, sleep);
  await waitForHealth(fetchImpl, env.MARKETING_HEALTH_URL, sleep);
}

const isMainModule = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  deployProduction({ fetchImpl: fetch, sleep: defaultSleep }, process.env).catch((error) => {
    console.error("Production deployment failed:", error?.message ?? error);
    process.exitCode = 1;
  });
}
