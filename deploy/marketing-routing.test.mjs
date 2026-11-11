import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("nginx serves only artisanmc.net: landing, wiki, health, and 404 elsewhere", () => {
  const nginx = read("editor/nginx.conf");
  assert.equal(nginx.match(/^\s*server\s*\{/gm)?.length, 1, "a single server block");
  assert.match(nginx, /server_name artisanmc\.net;/);
  assert.match(nginx, /location = \/health\s*\{[^}]*return 200/s);
  assert.match(nginx, /location = \/\s*\{[^}]*try_files \/index\.html =404/s);
  const fallback = nginx.match(/location \/\s*\{([^}]+)\}/)?.[1];
  assert.ok(fallback, "catch-all location");
  assert.match(fallback, /try_files \$uri =404/);
  assert.doesNotMatch(fallback, /index\.html/, "unknown paths must not fall back to the SPA");
});

test("no cloud leftovers: no pricing page, no editor host or redirect", () => {
  const nginx = read("editor/nginx.conf");
  assert.doesNotMatch(nginx, /\/pricing/);
  assert.doesNotMatch(nginx, /editor\.artisanmc\.net|@editor_redirect|server_name _;/);
});

test("the site image builds without cloud build args and is health-checked on the apex", () => {
  const docker = read("editor/Dockerfile");
  assert.match(docker, /RUN npm run build:site/);
  assert.doesNotMatch(docker, /ARG VITE_/);
  assert.match(read(".github/workflows/deploy.yml"), /MARKETING_HEALTH_URL: https:\/\/artisanmc\.net\//);
});
