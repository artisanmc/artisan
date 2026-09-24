import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the apex serves marketing pages and sends application paths to the editor", () => {
  const nginx = read("editor/nginx.conf");
  assert.match(nginx, /server_name artisanmc\.net;/);
  assert.match(nginx, /location = \/pricing\s*\{[^}]*index\.html/s);
  assert.match(nginx, /location @editor_redirect\s*\{[^}]*https:\/\/editor\.artisanmc\.net\$request_uri/s);
  assert.match(nginx, /server_name _;/);
  assert.match(nginx, /location = \/pricing\s*\{[^}]*https:\/\/artisanmc\.net\$request_uri/s);
});

test("production builds and health checks both public hosts", () => {
  assert.match(read("editor/Dockerfile"), /ARG VITE_EDITOR_URL=https:\/\/editor\.artisanmc\.net/);
  assert.match(read(".github/workflows/ci.yml"), /VITE_EDITOR_URL: https:\/\/editor\.artisanmc\.net/);
  assert.match(read(".github/workflows/deploy.yml"), /MARKETING_HEALTH_URL: https:\/\/artisanmc\.net\//);
});
