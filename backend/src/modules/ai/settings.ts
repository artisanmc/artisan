import { getSetting, setSetting } from "../../lib/appSettings";

export const AI_SETTINGS_KEY = "ai_settings";

export interface AiSettings {
	/** Micro-USD value of 1 credit — margin analytics only. Default $0.01. */
	creditUsdMicroRate: number;
	/** Hard cap of credits one turn may burn (agentic-loop guard). null = uncapped. */
	maxCreditsPerTurn: number | null;
	/** Margin applied to the real provider price when suggesting a model's
	 *  credit price in the admin form. 100 = ×2. Suggestion only — never billed. */
	pricingMarginPct: number;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
	creditUsdMicroRate: 10_000,
	maxCreditsPerTurn: null,
	pricingMarginPct: 100,
};

export async function getAiSettings(): Promise<AiSettings> {
	const stored = await getSetting<Partial<AiSettings>>(AI_SETTINGS_KEY);
	return { ...DEFAULT_AI_SETTINGS, ...(stored ?? {}) };
}

export async function putAiSettings(
	patch: Partial<AiSettings>,
	updatedBy: string | null,
): Promise<AiSettings> {
	const next = { ...(await getAiSettings()), ...patch };
	await setSetting(AI_SETTINGS_KEY, next, updatedBy);
	return next;
}
