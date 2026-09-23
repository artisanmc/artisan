import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
};

export function createWikiMiddleware(directory) {
  const root = resolve(directory);
  return async (request, response, next) => {
    const [pathname, ...query] = (request.url ?? "/").split("?");
    if (pathname !== "/wiki" && !pathname.startsWith("/wiki/")) return next();
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    let decoded;
    try {
      decoded = decodeURIComponent(pathname.slice("/wiki".length));
    } catch {
      response.writeHead(400).end();
      return;
    }
    if (
      decoded.includes("\\") ||
      decoded.includes("\0") ||
      decoded.split("/").some((part) => part === ".." || part === ".")
    ) {
      response.writeHead(400).end();
      return;
    }
    let file = resolve(root, `.${decoded || "/"}`);
    if (file !== root && !file.startsWith(`${root}${sep}`)) {
      response.writeHead(400).end();
      return;
    }
    try {
      const fileStat = await stat(file);
      if (fileStat.isDirectory()) {
        if (!pathname.endsWith("/")) {
          response
            .writeHead(308, {
              Location: `${pathname}/${query.length ? `?${query.join("?")}` : ""}`,
            })
            .end();
          return;
        }
        file = resolve(file, "index.html");
      }
      const body = await readFile(file);
      response.writeHead(200, {
        "Content-Type": contentTypes[extname(file)] ?? "application/octet-stream",
        "Content-Length": body.length,
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") return next(error);
      const body = await readFile(resolve(root, "404.html")).catch(() => "Wiki page not found");
      response.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      response.end(request.method === "HEAD" ? undefined : body);
    }
  };
}
