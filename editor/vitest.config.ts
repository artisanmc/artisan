import path from "node:path";
import { defineConfig } from "vitest/config";
import { vitestWorkerExecArgv } from "./vitest-worker-args.mjs";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "tests/e2e/**"],
    // Node 25 enabled native Web Storage by default; its localStorage shadows
    // jsdom's polyfill but exposes methods as non-functions in the test pool.
    execArgv: vitestWorkerExecArgv(),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@artisan/editor-sdk": path.resolve(__dirname, "./packages/editor-sdk/src/index.ts"),
      "@artisan/quests-editor": path.resolve(__dirname, "./packages/quests-editor/src/index.ts"),
      "@artisan/boutique-editor": path.resolve(__dirname, "./packages/boutique-editor/src/index.ts"),
      // projectImportRoundTrip.test.ts imports backend/src/lib/projectImport.ts,
      // whose "yaml" import resolves from backend/node_modules — absent in CI
      // (the editor job only runs npm ci). Pin it to the editor's copy.
      yaml: path.resolve(__dirname, "./node_modules/yaml"),
    },
  },
});
