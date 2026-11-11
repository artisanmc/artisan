import path from "node:path";
import { defineConfig } from "vitest/config";
import { vitestWorkerExecArgv } from "./vitest-worker-args.mjs";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/e2e/**"],
    // The app calls its same-origin hub (`VITE_API_URL` empty); tests pin an
    // absolute origin so they can parse the URLs they intercept.
    env: { VITE_API_URL: "http://localhost:3001" },
    // Node 25 enabled native Web Storage by default; its localStorage shadows
    // jsdom's polyfill but exposes methods as non-functions in the test pool.
    execArgv: vitestWorkerExecArgv(),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@artisan/editor-sdk": path.resolve(__dirname, "./packages/editor-sdk/src/index.ts"),
      "@artisan/boutique-editor": path.resolve(
        __dirname,
        "./packages/boutique-editor/src/index.ts",
      ),
    },
  },
});
