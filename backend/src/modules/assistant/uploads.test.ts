import { expect, it } from "bun:test";
import { mergeUploads } from "./uploads";

it("hosted uploads stay in their authorized Network and do not inherit a live server scope", () => {
  const stored = { networkId: "n", serverKeyId: null, files: { "x.yaml": "private" } };
  expect(mergeUploads(stored, { networkId: "n", serverKeyId: null }, {})).toEqual(stored.files);
  expect(mergeUploads(stored, { networkId: "other", serverKeyId: null }, {})).toEqual({});
  expect(mergeUploads(stored, { networkId: "n", serverKeyId: "server" }, {})).toEqual({});
});

it("does not reuse uploads after a network or server scope change", () => {
	const stored = {
		networkId: "network-a",
		serverKeyId: "server-a",
		files: { "private.yml": "secret" },
	};
	expect(
		mergeUploads(
			stored,
			{ networkId: "network-b", serverKeyId: "server-a" },
			{},
		),
	).toEqual({});
	expect(
		mergeUploads(
			stored,
			{ networkId: "network-a", serverKeyId: "server-b" },
			{ "new.yml": "new" },
		),
	).toEqual({ "new.yml": "new" });
	expect(mergeUploads(stored, stored, {})).toEqual(stored.files);
});

it("bounds accumulated storage without corrupting previous files, and treats names only as keys", () => {
	const scope = { networkId: "n", serverKeyId: "s" };
	const files = Object.fromEntries(
		Array.from({ length: 8 }, (_, i) => [
			String(i),
			"a".repeat(1024 * 1024 - 100),
		]),
	);
	const stored = { ...scope, files };
	expect(() =>
		mergeUploads(stored, scope, { extra: "a".repeat(1024) }),
	).toThrow("attachments_too_large");
	expect(Object.keys(stored.files)).toHaveLength(8);
	const merged = mergeUploads(
		null,
		scope,
		JSON.parse('{"__proto__":"file data","constructor":"more data"}'),
	);
	expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
	expect(Object.keys(merged)).toEqual(["__proto__", "constructor"]);
	expect(merged.__proto__).toBe("file data");
});
