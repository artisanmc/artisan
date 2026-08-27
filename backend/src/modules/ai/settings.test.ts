import { afterEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../db/index";
import { appSettings } from "../../db/schema";
import { AI_SETTINGS_KEY, DEFAULT_AI_SETTINGS, getAiSettings, putAiSettings } from "./settings";

afterEach(async () => {
	await db.delete(appSettings).where(eq(appSettings.key, AI_SETTINGS_KEY));
});

describe("ai settings", () => {
	it("defaults to a 100% margin on the real provider price", async () => {
		expect(DEFAULT_AI_SETTINGS.pricingMarginPct).toBe(100);
		expect((await getAiSettings()).pricingMarginPct).toBe(100);
	});

	it("persists a margin patch", async () => {
		const next = await putAiSettings({ pricingMarginPct: 40 }, null);
		expect(next.pricingMarginPct).toBe(40);
		expect((await getAiSettings()).pricingMarginPct).toBe(40);
	});
});
