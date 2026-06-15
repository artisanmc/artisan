import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "tests/e2e/**"],
    // Node 25 enabled native Web Storage by default; its localStorage shadows
    // jsdom's polyfill but exposes methods as non-functions in the test pool.
    execArgv: ["--no-webstorage"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@artisan/editor-sdk": path.resolve(__dirname, "./src/sdk/index.ts"),
    },
  },
});
