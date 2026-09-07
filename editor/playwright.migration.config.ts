import { defineConfig } from "@playwright/test";
export default defineConfig({
	testDir: "./e2e",
	testMatch: "migration.spec.ts",
	timeout: 60000,
	use: {
		baseURL: "http://127.0.0.1:5183",
		viewport: { width: 1100, height: 900 },
		locale: "en-US",
		trace: "retain-on-failure",
	},
	webServer: {
		command: "npm exec vite -- --config vite.migration.config.ts",
		url: "http://127.0.0.1:5183",
		reuseExistingServer: false,
		timeout: 60000,
	},
});
