#!/usr/bin/env node
// Runs the editor's pack builder outside the browser (`npm run pack -- <command>`): the
// TypeScript sources load through jiti with the `@/` alias of vite.config.ts.
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const src = fileURLToPath(new URL("../src", import.meta.url));
const jiti = createJiti(import.meta.url, {
  alias: {
    "@": src,
    "@artisan/editor-sdk": fileURLToPath(
      new URL("../packages/editor-sdk/src/index.ts", import.meta.url),
    ),
  },
});
const { main } = await jiti.import("./pack/cli.ts");
process.exitCode = await main(process.argv.slice(2));
