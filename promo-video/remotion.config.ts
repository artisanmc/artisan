import path from "node:path";
import { Config } from "@remotion/cli/config";
import { enableTailwind } from "@remotion/tailwind-v4";

const editor = path.resolve(process.cwd(), "../editor");
const editorModules = path.join(editor, "node_modules");

Config.setVideoImageFormat("jpeg");
Config.setConcurrency(4);
Config.overrideWebpackConfig((config) => {
  const withTailwind = enableTailwind(config);
  return {
    ...withTailwind,
    resolve: {
      ...withTailwind.resolve,
      // Les composants viennent de editor/src : mêmes alias que vite.config.ts,
      // et une seule copie de React : Remotion fixe déjà `react`, on aligne `react-dom`.
      alias: {
        ...(withTailwind.resolve?.alias ?? {}),
        "@": path.join(editor, "src"),
        "@artisan/editor-sdk": path.join(editor, "packages/editor-sdk/src/index.ts"),
        "@artisan/quests-editor": path.join(editor, "packages/quests-editor/src/index.ts"),
        "@artisan/boutique-editor": path.join(editor, "packages/boutique-editor/src/index.ts"),
        "react-dom": path.resolve(process.cwd(), "node_modules/react-dom"),
      },
      modules: ["node_modules", editorModules],
    },
  };
});
