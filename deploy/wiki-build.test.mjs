import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the wiki build shares the editor deployment and is included in CI", async () => {
  const docker = await read("editor/Dockerfile");
  const ignore = await read(".dockerignore");
  const workflow = await read(".github/workflows/ci.yml");
  const editor = JSON.parse(await read("editor/package.json"));
  assert.match(docker, /COPY docs-site\/package\.json docs-site\/package-lock\.json/);
  assert.match(docker, /COPY editor\/packages/);
  assert.ok(docker.indexOf("COPY editor/packages") < docker.indexOf("RUN npm ci"));
  assert.doesNotMatch(ignore, /^docs-site\s*$/m);
  assert.match(workflow, /working-directory: docs-site/);
  assert.match(editor.scripts.prebuild, /docs-site.*build/);
  assert.match(editor.scripts.predev, /docs-site.*build/);
  assert.match(editor.scripts.postbuild, /copy-wiki/);
});

test("production wiki locations do not use the application fallback", async () => {
  const nginx = await read("editor/nginx.conf");
  assert.match(
    nginx,
    /absolute_redirect off;/,
    "redirects must preserve the public proxy scheme and port",
  );
  assert.match(nginx, /location = \/wiki\s*\{[^}]*return 308 \/wiki\//);
  const wikiLocation = nginx.match(/location \^~ \/wiki\/\s*\{([^}]+)\}/)?.[1];
  assert.ok(wikiLocation, "dedicated wiki prefix location");
  assert.match(wikiLocation, /try_files \$uri \$uri\/ =404/);
  assert.match(wikiLocation, /error_page 404 \/wiki\/404\.html/);
  assert.doesNotMatch(wikiLocation, /\/index\.html/);
});

test("wiki branding builds without a sibling editor directory", async () => {
  const config = await read("docs-site/astro.config.mjs");
  const source = config.match(/logo:\s*\{\s*src:\s*['"]([^'"]+)['"]/)?.[1];
  assert.ok(
    source?.startsWith("./"),
    "the wiki logo must live inside docs-site for Docker Compose",
  );
  const logo = await read(`docs-site/${source.slice(2)}`);
  const editorLogo = await read("editor/public/logo.svg");
  const favicon = await read("docs-site/public/favicon.svg");
  const normalize = (svg) => svg.replace(/\s+/g, " ").trim();
  assert.equal(normalize(logo), normalize(editorLogo));
  assert.equal(normalize(favicon), normalize(editorLogo));
});
