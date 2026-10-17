import { artisanModuleBundle } from "@artisan/editor-sdk/bundle";
import { defineConfig } from "vite";

// The bundle ArtisanQuests embeds in its jar (`artisan-editor/ui.js`).
export default defineConfig(
  artisanModuleBundle({ entry: "src/index.ts", root: import.meta.dirname }),
);
