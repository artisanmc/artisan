import assert from "node:assert/strict";
import { access, readFile, readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../dist/", import.meta.url));
const applicationPaths = new Set(["/", "/pricing", "/networks"]);
const allowedApplicationPaths = new Set([...applicationPaths, "/demo"]);
const pages = (await readdir(root, { recursive: true })).filter((path) => path.endsWith(".html"));
assert.ok(pages.length > 10, "The wiki must contain its complete guides, not just a landing page.");
await access(join(root, "pagefind", "pagefind.js"));
await access(join(root, "pagefind", "pagefind-entry.json"));
await access(join(root, "404.html"));
const failures = [];

for (const page of pages) {
  const html = await readFile(join(root, page), "utf8");
  const pathname = `/wiki/${page.split(sep).join("/").replace(/index\.html$/, "")}`;
  for (const [, attribute] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const url = new URL(attribute.replaceAll("&amp;", "&"), `https://artisan.test${pathname}`);
    if (url.origin !== "https://artisan.test" || allowedApplicationPaths.has(url.pathname)) continue;
    if (!url.pathname.startsWith("/wiki/")) {
      failures.push(`${page}: escapes the wiki base: ${attribute}`);
      continue;
    }
    let target = join(root, decodeURIComponent(url.pathname.slice("/wiki/".length)));
    try {
      if ((await stat(target)).isDirectory()) target = join(target, "index.html");
      await access(target);
      if (url.hash && target.endsWith(".html")) {
        const targetHtml = target === join(root, page) ? html : await readFile(target, "utf8");
        const anchor = decodeURIComponent(url.hash.slice(1));
        assert.ok(targetHtml.includes(`id="${anchor}"`), `missing anchor ${anchor}`);
      }
    } catch (error) {
      failures.push(`${page}: ${attribute} → ${relative(root, target)} (${error.message})`);
    }
  }
  for (const path of applicationPaths) {
    assert.ok(html.includes(`href="${path}"`), `${page} must link back to ${path}`);
  }
}

assert.deepEqual(failures, [], "Every wiki guide, asset and anchor must resolve under /wiki/.");
console.log(`Verified ${pages.length} wiki pages, internal links, navigation, assets, and Pagefind index.`);
