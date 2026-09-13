import { expect, test } from "bun:test";
import { demoMinecraftVersion } from "./demoVersion";
test("demo version defaults and accepts exact installed catalog", async () => {
	expect(
		await demoMinecraftVersion(undefined, async (v) => v === "1.21.4"),
	).toBe("1.21.4");
	expect(
		await demoMinecraftVersion("1.21.11", async (v) => v === "1.21.11"),
	).toBe("1.21.11");
});
test("unsupported and pathlike versions reject before storage", async () => {
	for (const version of ["../../x", "1.21.99", ""]) {
		let error: unknown;
		try {
			await demoMinecraftVersion(version, async () => false);
		} catch (e) {
			error = e;
		}
		expect(error).toMatchObject({ code: "invalid_demo_version" });
	}
});
