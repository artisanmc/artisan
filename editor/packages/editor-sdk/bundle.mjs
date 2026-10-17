// @ts-check
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Vite settings that build a module's editor view as a bundle the editor loads at
 * runtime (ADR `runtime-editor-modules`): one ES module, React and the SDK left as
 * imports (the editor provides them), everything else inlined, and the SDK version it
 * was built against stamped on its default export.
 *
 *   // vite.bundle.config.mjs
 *   import { defineConfig } from "vite";
 *   import { artisanModuleBundle } from "@artisan/editor-sdk/bundle";
 *   export default defineConfig(artisanModuleBundle({ entry: "src/index.ts" }));
 *
 * The output (`dist/ui.js`) goes into the module's jar; the module registers it with
 * `api.getEditorBundles().register(EditorBundleDeclaration.fromResource(…, sdk))`,
 * `sdk` being the version printed at the end of the build.
 *
 * @param {{ entry: string, outDir?: string, fileName?: string, root?: string }} options
 * @returns {import("vite").UserConfig}
 */
export function artisanModuleBundle({
  entry,
  outDir = "dist",
  fileName = "ui.js",
  root = process.cwd(),
}) {
  const sdkVersion = JSON.parse(
    readFileSync(new URL("./package.json", import.meta.url), "utf8"),
  ).version;
  const shared = ["react", "react-dom", "react/jsx-runtime", "@artisan/editor-sdk"];
  const virtualEntry = "virtual:artisan-module-entry";
  const realEntry = resolve(root, entry);
  return {
    root,
    // A bundle is code, not a page: no public dir, no HTML.
    publicDir: false,
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    esbuild: { jsx: "automatic", jsxImportSource: "react" },
    plugins: [
      {
        name: "artisan-module-entry",
        enforce: "pre",
        // Lib mode hands the entry over as a path under `root`.
        resolveId: (id) => (id.endsWith(virtualEntry) ? `\0${virtualEntry}` : null),
        load: (id) =>
          id === `\0${virtualEntry}`
            ? `import mod from ${JSON.stringify(realEntry)};\nexport default { ...mod, sdk: ${JSON.stringify(sdkVersion)} };\n`
            : null,
      },
      {
        name: "artisan-module-report",
        closeBundle() {
          console.log(`[artisan] module bundle built against @artisan/editor-sdk ${sdkVersion}`);
        },
      },
    ],
    build: {
      outDir: resolve(root, outDir),
      emptyOutDir: true,
      target: "es2022",
      minify: true,
      cssCodeSplit: false,
      lib: { entry: virtualEntry, formats: ["es"], fileName: () => fileName },
      rollupOptions: {
        external: (id) => shared.includes(id),
        output: { inlineDynamicImports: true },
      },
    },
  };
}
