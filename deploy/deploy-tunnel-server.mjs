import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import {
  buildHeaders,
  fetchWithTimeout,
  triggerDeployment,
  waitForDeployment,
  waitForHealth,
} from "./coolify-deploy.mjs";

const REQUIRED_ENV_KEYS = [
  "COOLIFY_BASE_URL",
  "COOLIFY_API_TOKEN",
  "COOLIFY_TUNNEL_SERVER_UUID",
  "CF_ACCESS_CLIENT_ID",
  "CF_ACCESS_CLIENT_SECRET",
  "TUNNEL_HEALTH_URL",
  "EXPECTED_SHA",
];

/** What the tunnel server image is built from: a change elsewhere leaves the running tunnels alone. */
export const TUNNEL_SERVER_PATHS = [
  "plugin/tunnel/",
  "plugin/tunnel-server/",
  "plugin/gradle/",
  "plugin/build.gradle.kts",
  "plugin/settings.gradle.kts",
  "deploy/tunnel-server/",
];

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** True when `git diff` sees no change to the tunnel server between the two commits; false if it cannot tell. */
export function tunnelServerUnchanged(from, to) {
  if (!/^[0-9a-f]{40}$/.test(from ?? "")) return false;
  try {
    execFileSync("git", ["diff", "--quiet", from, to, "--", ...TUNNEL_SERVER_PATHS], { stdio: "ignore" });
    return true;
  } catch {
    // Exit code 1 (changes) or an unknown commit: deploy.
    return false;
  }
}

export async function deployedRevision(fetchImpl, config, resourceUuid) {
  const url = `${config.COOLIFY_BASE_URL}/api/v1/applications/${encodeURIComponent(resourceUuid)}`;
  const response = await fetchWithTimeout(fetchImpl, url, { headers: buildHeaders(config) });
  if (!response.ok) {
    throw new Error(`Coolify application read failed with HTTP ${response.status}`);
  }
  const { git_commit_sha: sha } = await response.json();
  return sha;
}

/** Pins the resource on main at the validated SHA: the resource may still follow another branch. */
export async function pinMainRevision(fetchImpl, config, resourceUuid) {
  const url = `${config.COOLIFY_BASE_URL}/api/v1/applications/${encodeURIComponent(resourceUuid)}`;
  const response = await fetchWithTimeout(fetchImpl, url, {
    method: "PATCH",
    headers: { ...buildHeaders(config), "Content-Type": "application/json" },
    body: JSON.stringify({ git_branch: "main", git_commit_sha: config.EXPECTED_SHA }),
  });
  if (!response.ok) {
    throw new Error(`Coolify revision pin failed with HTTP ${response.status}`);
  }
}

export async function deployTunnelServer(deps, env) {
  const missing = REQUIRED_ENV_KEYS.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  const { fetchImpl, sleep = defaultSleep, unchanged = tunnelServerUnchanged, log = console.log } = deps;
  const uuid = env.COOLIFY_TUNNEL_SERVER_UUID;
  const deployed = await deployedRevision(fetchImpl, env, uuid);
  // A redeploy drops every open tunnel (plugins reconnect): only when the server itself changed.
  if (unchanged(deployed, env.EXPECTED_SHA)) {
    log(`Tunnel server unchanged since ${deployed}: not redeployed.`);
    return false;
  }
  await pinMainRevision(fetchImpl, env, uuid);
  const deployment = await triggerDeployment(fetchImpl, env, uuid);
  await waitForDeployment(fetchImpl, env, deployment, sleep);
  await waitForHealth(fetchImpl, env.TUNNEL_HEALTH_URL, sleep);
  return true;
}

const isMainModule = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  deployTunnelServer({ fetchImpl: fetch, sleep: defaultSleep }, process.env).catch((error) => {
    console.error("Tunnel server deployment failed:", error?.message ?? error);
    process.exitCode = 1;
  });
}
