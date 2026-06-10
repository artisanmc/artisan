import { afterAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { networks } from "../db/schema";
import { createNetwork } from "./networkManager";

describe("slug allocation on create", () => {
	const created: string[] = [];
	afterAll(async () => {
		for (const id of created)
			await db.delete(networks).where(eq(networks.id, id));
	});

	it("createNetwork assigns a slug derived from the name", async () => {
		const n = await createNetwork("Survie PvP Slugtest");
		created.push(n.id);
		expect(n.slug).toBe("survie-pvp-slugtest");
	});

	it("dedups colliding names with a numeric suffix", async () => {
		const a = await createNetwork("Collide Slugtest XQ");
		const b = await createNetwork("Collide Slugtest XQ");
		created.push(a.id, b.id);
		expect(a.slug).toBe("collide-slugtest-xq");
		expect(b.slug).toBe("collide-slugtest-xq-2");
	});
});
