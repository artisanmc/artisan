import path from "node:path";
import { createRequire } from "node:module";
import type webpackNs from "webpack";
import { Config } from "@remotion/cli/config";
import { enableTailwind } from "@remotion/tailwind-v4";

// Le webpack de Remotion, pas une autre copie : DefinePlugin doit venir du même paquet que le compilateur.
const webpack: typeof webpackNs = createRequire(require.resolve("@remotion/bundler"))("webpack");

const editor = path.resolve(process.cwd(), "../editor");
const editorModules = path.join(editor, "node_modules");
Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(95);
Config.setConcurrency(4);
// L'éditeur est monté à 1600×900 (la taille des captures de la page de vente), sorti en 1920×1080.
Config.setScale(1.2);
Config.overrideWebpackConfig((config) => {
  const withTailwind = enableTailwind(config);
  return {
    ...withTailwind,
    plugins: [
      ...(withTailwind.plugins ?? []),
      // L'éditeur et son hub (scripts/hub.mjs) partagent la même origine, comme servis par le plugin.
      new webpack.DefinePlugin({ "import.meta.env.VITE_API_URL": JSON.stringify("") }),
    ],
    resolve: {
      ...withTailwind.resolve,
      // L'éditeur vient de editor/src : mêmes alias que vite.config.ts,
      // et une seule copie de React : Remotion fixe déjà `react`, on aligne `react-dom`.
      alias: {
        ...(withTailwind.resolve?.alias ?? {}),
        "@": path.join(editor, "src"),
        "@artisan/editor-sdk": path.join(editor, "packages/editor-sdk/src/index.ts"),
        "@artisan/boutique-editor": path.join(editor, "packages/boutique-editor/src/index.ts"),
        "react-dom": path.resolve(process.cwd(), "node_modules/react-dom"),
      },
      modules: ["node_modules", editorModules],
    },
  };
});
