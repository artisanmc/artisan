import { cp } from "node:fs/promises";

await cp(
  new URL("../../docs-site/dist/", import.meta.url),
  new URL("../dist/wiki/", import.meta.url),
  { recursive: true },
);
console.log("Artisan wiki included at /wiki/");
