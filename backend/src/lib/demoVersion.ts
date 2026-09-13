import { join } from "node:path";
export async function demoMinecraftVersion(
	value = process.env.DEMO_MINECRAFT_VERSION,
	available = (version: string) =>
		Bun.file(
			join(import.meta.dir, "../../data/items", `${version}.json`),
		).exists(),
) {
	const version = value ?? "1.21.4";
	if (!/^\d+\.\d+(?:\.\d+)?$/.test(version) || !(await available(version)))
		throw Object.assign(new Error("invalid_demo_version"), {
			code: "invalid_demo_version",
		});
	return version;
}
