import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createWikiMiddleware } from "../editor/scripts/wiki-middleware.mjs";

let directory;
let server;
let origin;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "artisan-wiki-"));
  await mkdir(join(directory, "editor"));
  await mkdir(join(directory, "pagefind"));
  await writeFile(join(directory, "index.html"), "<h1>Artisan wiki</h1>");
  await writeFile(join(directory, "404.html"), "<h1>Wiki page not found</h1>");
  await writeFile(join(directory, "editor", "index.html"), "<h1>Editor guide</h1>");
  await writeFile(join(directory, "pagefind", "pagefind.js"), "export const search = () => [];");
  await writeFile(join(directory, "pagefind", "index.wasm"), "wasm");
  const wiki = createWikiMiddleware(directory);
  server = createServer((request, response) => {
    wiki(request, response, () => {
      response.end("Artisan application");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
});

test("wiki root redirects to its canonical directory, preserving the query", async () => {
  const response = await fetch(`${origin}/wiki?q=menu`, { redirect: "manual" });
  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), "/wiki/?q=menu");
});

test("wiki guides and landing are served independently from the application", async () => {
  assert.match(await (await fetch(`${origin}/wiki/`)).text(), /Artisan wiki/);
  assert.match(await (await fetch(`${origin}/wiki/editor/`)).text(), /Editor guide/);
  assert.match(await (await fetch(`${origin}/`)).text(), /Artisan application/);
  assert.match(await (await fetch(`${origin}/wikipedia`)).text(), /Artisan application/);
});

test("directory pages redirect before relative links are resolved", async () => {
  const response = await fetch(`${origin}/wiki/editor?from=home`, { redirect: "manual" });
  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), "/wiki/editor/?from=home");
});

test("Pagefind assets retain executable MIME types and HEAD has no body", async () => {
  const script = await fetch(`${origin}/wiki/pagefind/pagefind.js`);
  assert.match(script.headers.get("content-type"), /javascript/);
  assert.match(await script.text(), /export const search/);
  const wasm = await fetch(`${origin}/wiki/pagefind/index.wasm`, { method: "HEAD" });
  assert.equal(wasm.headers.get("content-type"), "application/wasm");
  assert.equal(await wasm.text(), "");
});

test("unknown wiki pages and assets return the wiki 404 instead of the SPA", async () => {
  for (const path of ["missing/", "pagefind/missing.js"]) {
    const response = await fetch(`${origin}/wiki/${path}`);
    assert.equal(response.status, 404);
    assert.match(await response.text(), /Wiki page not found/);
  }
});

test("malformed paths and encoded path traversal cannot access parent files", async () => {
  for (const path of ["%", "%2e%2e%2fpackage.json", "%5c..%5cpackage.json"]) {
    const response = await fetch(`${origin}/wiki/${path}`);
    assert.equal(response.status, 400);
  }
});

test("wiki static content rejects mutations", async () => {
  const response = await fetch(`${origin}/wiki/`, { method: "POST" });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET, HEAD");
});
