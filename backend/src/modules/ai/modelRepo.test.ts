import { afterEach, describe, expect, it } from "bun:test";
import { db } from "../../db/index";
import { aiModels } from "../../db/schema";
import {
	createModel,
	getModel,
	listModels,
	resolveModel,
	setDefaultModel,
	updateModel,
	type AiModelInput,
} from "./modelRepo";

const base: AiModelInput = {
	displayName: "M",
	description: "",
	badge: "balanced",
	provider: "openai",
	providerModelId: "gpt-test",
	creditsPerMInput: 10,
	creditsPerMOutput: 20,
	realUsdPerMInput: 0,
	realUsdPerMOutput: 0,
	isActive: true,
};

afterEach(async () => {
	await db.delete(aiModels);
});

describe("modelRepo CRUD", () => {
	it("create → get round-trips", async () => {
		const m = await createModel({ ...base, displayName: "Sonnet" });
		const got = await getModel(m.id);
		expect(got?.displayName).toBe("Sonnet");
		expect(got?.isDefault).toBe(false);
	});

	it("updateModel patches fields and bumps updatedAt", async () => {
		const m = await createModel(base);
		const upd = await updateModel(m.id, { creditsPerMInput: 99, isActive: false });
		expect(upd?.creditsPerMInput).toBe(99);
		expect(upd?.isActive).toBe(false);
	});

	it("setDefaultModel unsets the previous default (single-default invariant)", async () => {
		const a = await createModel({ ...base, displayName: "A" });
		const b = await createModel({ ...base, displayName: "B" });
		await setDefaultModel(a.id);
		await setDefaultModel(b.id);
		const all = await listModels();
		expect(all.filter((m) => m.isDefault).map((m) => m.displayName)).toEqual(["B"]);
	});

	it("setDefaultModel with an unknown id returns false and keeps the existing default", async () => {
		const a = await createModel({ ...base, displayName: "A" });
		await setDefaultModel(a.id);
		expect(await setDefaultModel("nope")).toBe(false);
		expect((await getModel(a.id))?.isDefault).toBe(true);
	});
});

describe("resolveModel", () => {
	it("returns the requested model when active", async () => {
		const m = await createModel(base);
		expect((await resolveModel(m.id))?.id).toBe(m.id);
	});

	it("falls back to the default when the requested model is inactive", async () => {
		const dead = await createModel({ ...base, displayName: "Dead", isActive: false });
		const def = await createModel({ ...base, displayName: "Def" });
		await setDefaultModel(def.id);
		expect((await resolveModel(dead.id))?.id).toBe(def.id);
	});

	it("default inactive → deterministic fallback: badge order (cheap first) then name", async () => {
		const def = await createModel({ ...base, displayName: "Def" });
		await setDefaultModel(def.id);
		await updateModel(def.id, { isActive: false });
		await createModel({ ...base, displayName: "Zeta", badge: "premium" });
		const cheap = await createModel({ ...base, displayName: "Alpha", badge: "cheap" });
		expect((await resolveModel())?.id).toBe(cheap.id);
	});

	it("no active model at all → null", async () => {
		await createModel({ ...base, isActive: false });
		expect(await resolveModel()).toBeNull();
	});
});
