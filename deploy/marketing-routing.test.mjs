import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the apex serves marketing pages and sends application paths to the editor", () => {
  const nginx = read("editor/nginx.conf");
  assert.match(nginx, /server_name \$\{MARKETING_HOST\};/);
  assert.match(nginx, /location = \/pricing\s*\{[^}]*index\.html/s);
  assert.match(nginx, /location @editor_redirect\s*\{[^}]*https:\/\/\$\{EDITOR_HOST\}\$request_uri/s);
  assert.match(nginx, /server_name _;/);
  assert.match(nginx, /location = \/pricing\s*\{[^}]*https:\/\/\$\{MARKETING_HOST\}\$request_uri/s);
});

test("the image renders hosts at boot and defaults to production", () => {
  const dockerfile = read("editor/Dockerfile");
  assert.match(dockerfile, /COPY editor\/nginx\.conf \/etc\/nginx\/templates\/default\.conf\.template/);
  assert.match(dockerfile, /ENV MARKETING_HOST=artisanmc\.net EDITOR_HOST=editor\.artisanmc\.net/);
});

test("staging deploys from its branch with its own hosts and plugin channel", () => {
  const deploy = read(".github/workflows/deploy.yml");
  assert.match(deploy, /branches: \[main, staging\]/);
  assert.match(deploy, /https:\/\/staging-api\.artisanmc\.net/);
  assert.match(deploy, /https:\/\/staging-editor\.artisanmc\.net/);
  assert.match(deploy, /https:\/\/staging\.artisanmc\.net/);
  assert.match(deploy, /-staging/);
  assert.match(read(".github/workflows/ci.yml"), /branches: \[main, staging\]/);
});

test("production builds and health checks both public hosts", () => {
  assert.match(read("editor/Dockerfile"), /ARG VITE_EDITOR_URL=https:\/\/editor\.artisanmc\.net/);
  assert.match(read(".github/workflows/ci.yml"), /VITE_EDITOR_URL: https:\/\/editor\.artisanmc\.net/);
  assert.match(read(".github/workflows/deploy.yml"), /'https:\/\/artisanmc\.net'/);
  assert.match(read(".github/workflows/deploy.yml"), /MARKETING_HEALTH_URL: \$\{\{ env\.MARKETING_URL \}\}\//);
});
