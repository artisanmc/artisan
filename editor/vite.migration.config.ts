import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
const path = (value: string) => fileURLToPath(new URL(value, import.meta.url));
export default defineConfig({
	root: path("./e2e/fixtures/migration"),
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: {
			"@": path("./src"),
			"@artisan/editor-sdk": path("./packages/editor-sdk/src/index.ts"),
			"@artisan/quests-editor": path("./packages/quests-editor/src/index.ts"),
			"@artisan/boutique-editor": path(
				"./packages/boutique-editor/src/index.ts",
			),
		},
	},
	server: {
		host: "127.0.0.1",
		port: 5183,
		strictPort: true,
		fs: { allow: [path(".")] },
	},
});
