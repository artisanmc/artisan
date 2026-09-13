import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, cp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { HostedProjectStorage } from "./HostedProjectStorage";

const roots: string[] = [];
const hash = (s: string | Uint8Array) =>
	createHash("sha256").update(s).digest("hex");
async function fixture(ownerId = "owner-a") {
	const volumeRoot = await mkdtemp(join(tmpdir(), "artisan-hosted-"));
	roots.push(volumeRoot);
	const options = {
		volumeRoot,
		rootId: crypto.randomUUID(),
		folderName: "project",
		projectId: "immutable",
		ownerId,
	};
	const storage = await HostedProjectStorage.initialize(options);
	return { storage, options };
}
afterEach(async () => {
	for (const p of roots.splice(0))
		await rm(p, { recursive: true, force: true });
});

test("hosted mixed text and binary CAS is atomic and persists across instances", async () => {
	const { storage, options } = await fixture();
	const bytes = new Uint8Array([0, 255, 128, 10]);
	expect(
		await storage.write({
			operationId: "initial",
			files: [
				{ path: "manifest.yaml", content: "name: Demo", base_hash: null },
			],
			binaries: [{ path: "textures/a.png", content: bytes, baseHash: null }],
		}),
	).toMatchObject({ result: { ok: true } });
	expect(
		await storage.write({
			files: [{ path: "manifest.yaml", content: "bad", base_hash: null }],
			binaries: [
				{ path: "textures/a.png", content: null, baseHash: hash(bytes) },
			],
		}),
	).toMatchObject({ result: { ok: false, error: "conflict" } });
	const reopened = await HostedProjectStorage.open(options);
	expect(await reopened.readBinary("textures/a.png")).toMatchObject({
		result: { content: bytes },
	});
	expect(await reopened.read()).toMatchObject({
		result: { files: [{ path: "manifest.yaml", content: "name: Demo" }] },
	});
});
test("two workers serialize CAS and a lost ACK replays only identical operation", async () => {
	const { storage, options } = await fixture();
	const other = await HostedProjectStorage.open(options);
	const batch = {
		operationId: "once",
		files: [{ path: "x.yaml", content: "a", base_hash: null }],
	};
	const outcomes = await Promise.all([
		storage.write(batch),
		other.write({ files: [{ path: "x.yaml", content: "b", base_hash: null }] }),
	]);
	expect(
		outcomes.filter((o) => o.kind === "result" && o.result.ok),
	).toHaveLength(1);
	if (outcomes[0]?.kind === "result" && outcomes[0].result.ok)
		expect(await other.write(batch)).toEqual(outcomes[0]);
	expect(
		await storage.write({
			...batch,
			files: [{ path: "x.yaml", content: "different", base_hash: null }],
		}),
	).toMatchObject({ result: { ok: false } });
});
test("rejects private paths, case aliases and ancestor collisions before any publication", async () => {
	const { storage } = await fixture();
	for (const paths of [
		[".artisan/drafts/d/draft.json"],
		["a", "a/b"],
		["A.yaml", "a.yaml"],
		["../escape"],
		["dir/.artisan/drafts/x"],
	]) {
		expect(
			await storage.write({
				files: paths.map((path) => ({ path, content: "x", base_hash: null })),
			}),
		).toMatchObject({ result: { ok: false, error: "invalid_path" } });
	}
	expect(
		await storage.write({
			files: [
				{
					path: ".artisan/editor.yaml",
					content: "layout: {}",
					base_hash: null,
				},
			],
		}),
	).toMatchObject({ result: { ok: true } });
	expect(await storage.read()).toMatchObject({
		result: {
			files: [{ path: ".artisan/editor.yaml", content: "layout: {}" }],
		},
	});
});
test("drafts keep owner and revision, private binary blobs, and atomic terminal publication", async () => {
	const { storage, options } = await fixture();
	const stranger = await HostedProjectStorage.open({
		...options,
		ownerId: "owner-b",
	});
	const snapshot = {
		baseline: {},
		tree: { "menu.yaml": "hello" },
		initialTree: {},
		at: 1,
	};
	expect(
		await storage.drafts.create("CON", "create-draft", {
			name: "Draft",
			snapshot,
		}),
	).toMatchObject({ result: { ok: true, draft: { revision: 1 } } });
	expect(await stranger.drafts.read("CON")).toMatchObject({
		result: { ok: false, error: "not_found" },
	});
	expect(
		await storage.drafts.update("CON", 2, "stale", { name: "wrong", snapshot }),
	).toMatchObject({ result: { ok: false, error: "draft_conflict" } });
	const bytes = Buffer.from([1, 255, 0]);
	const digest = hash(bytes);
	expect(
		await storage.drafts.writeBlob(
			"CON",
			1,
			"blob",
			digest,
			bytes.toString("base64"),
		),
	).toMatchObject({ result: { ok: true } });
	const next = {
		...snapshot,
		binaryTree: { "textures/d.png": { hash: digest, size: bytes.length } },
	};
	expect(
		await storage.drafts.update("CON", 1, "update", {
			name: "Draft",
			snapshot: next,
		}),
	).toMatchObject({ result: { ok: true, draft: { revision: 2 } } });
	expect(await storage.read()).toMatchObject({
		result: { files: [], binaries: [] },
	});
	const published = await storage.drafts.publish("CON", 2, "publish");
	expect(published).toMatchObject({
		result: { ok: true, draft: { status: "published", revision: 3 } },
	});
	expect(await storage.drafts.publish("CON", 2, "publish")).toEqual(published);
	expect(await storage.readBinary("textures/d.png")).toMatchObject({
		result: { content: new Uint8Array(bytes) },
	});
	expect(await stranger.drafts.readBlob("CON", digest)).toMatchObject({
		result: { error: "not_found" },
	});
});
test("whole volume restore retains drafts, content, binary history and receipts", async () => {
	const { storage, options } = await fixture();
	await storage.write({
		operationId: "first",
		files: [{ path: "x.yaml", content: "one", base_hash: null }],
	});
	await storage.write({
		operationId: "second",
		files: [{ path: "x.yaml", content: "two", base_hash: hash("one") }],
	});
	await storage.drafts.create("DRAFT", "draft", {
		name: "private",
		snapshot: { baseline: {}, tree: {}, at: 1 },
	});
	const restored = await mkdtemp(join(tmpdir(), "artisan-restored-"));
	roots.push(restored);
	await cp(options.volumeRoot, restored, { recursive: true });
	const copy = await HostedProjectStorage.open({
		...options,
		volumeRoot: restored,
	});
	expect(await copy.history("x.yaml")).toMatchObject({
		result: { versions: [{ content: "one" }] },
	});
	expect(await copy.drafts.read("DRAFT")).toMatchObject({
		result: { draft: { ownerId: "owner-a" } },
	});
	expect(
		await copy.write({
			operationId: "second",
			files: [{ path: "x.yaml", content: "two", base_hash: hash("one") }],
		}),
	).toMatchObject({ result: { ok: true } });
});
test("separate backend processes serialize a competing CAS through PostgreSQL", async () => {
	const { options } = await fixture();
	const argument = Buffer.from(JSON.stringify(options)).toString("base64");
	const worker = join(import.meta.dir, "hostedWorker.fixture.ts");
	const run = async (content: string) => {
		const child = Bun.spawn([process.execPath, worker, argument, content], {
			stdout: "pipe",
			stderr: "pipe",
			env: process.env,
		});
		const output = await new Response(child.stdout).text();
		const errors = await new Response(child.stderr).text();
		expect(await child.exited).toBe(0);
		if (!output) throw new Error(errors);
		return JSON.parse(output);
	};
	const values = await Promise.all([run("one"), run("two")]);
	expect(values.filter((v) => v.result.ok)).toHaveLength(1);
	expect(values.filter((v) => v.result.error === "conflict")).toHaveLength(1);
});
test("crash at every activation boundary preserves whole publication and retry receipt", async () => {
	for (const step of ["staged", "before_activate", "activated"]) {
		const { storage, options } = await fixture();
		const snapshot = {
			baseline: {},
			tree: { "ready.yaml": "complete" },
			at: 1,
		};
		await storage.drafts.create("draft", "create", { name: "Draft", snapshot });
		const crashing = await HostedProjectStorage.open({
			...options,
			checkpoint: async (actual) => {
				if (actual === step) throw new Error("simulated_crash");
			},
		});
		let failed = false;
		try {
			await crashing.drafts.publish("draft", 1, "publish");
		} catch {
			failed = true;
		}
		expect(failed).toBe(true);
		const resumed = await HostedProjectStorage.open(options);
		const draft = await resumed.drafts.read("draft");
		expect(draft).toMatchObject({
			result: {
				draft: { status: step === "activated" ? "published" : "active" },
			},
		});
		expect(await resumed.read()).toMatchObject({
			result: {
				files:
					step === "activated"
						? [{ path: "ready.yaml", content: "complete" }]
						: [],
			},
		});
		expect(await resumed.drafts.publish("draft", 1, "publish")).toMatchObject({
			result: { ok: true, draft: { status: "published", revision: 2 } },
		});
	}
});
test("owner purge removes portable private files and receipt payloads without affecting public content", async () => {
	const { storage, options } = await fixture();
	const other = await HostedProjectStorage.open({
		...options,
		ownerId: "other",
	});
	await storage.drafts.create("Private", "owner-operation", {
		name: "private",
		snapshot: { baseline: {}, tree: {}, at: 1 },
	});
	await other.drafts.create("Other", "other-operation", {
		name: "other",
		snapshot: { baseline: {}, tree: {}, at: 1 },
	});
	await storage.purgeOwners(["owner-a"]);
	expect(await storage.drafts.read("Private")).toMatchObject({
		result: { error: "not_found" },
	});
	expect(await other.drafts.read("Other")).toMatchObject({
		result: { ok: true },
	});
	expect(
		await storage.drafts.create("Private", "owner-operation", {
			name: "private",
			snapshot: { baseline: {}, tree: {}, at: 1 },
		}),
	).toMatchObject({ result: { error: "operation_expired" } });
});
test("a corrupt published tree cannot be silently reinitialized and private blobs verify their digest", async () => {
	const { storage, options } = await fixture();
	await storage.write({
		files: [{ path: "x.yaml", content: "keep", base_hash: null }],
	});
	const current = await storage.filesystem.current();
	await rm(join(current.directory, current.state.folderName, "x.yaml"));
	let rejected = false;
	try {
		await HostedProjectStorage.initialize(options);
	} catch {
		rejected = true;
	}
	expect(rejected).toBe(true);
	await writeFile(
		join(current.directory, current.state.folderName, "x.yaml"),
		"keep",
	);
	await storage.drafts.create("d", "create-d", {
		name: "D",
		snapshot: { baseline: {}, tree: {}, at: 1 },
	});
	const bytes = Buffer.from("blob");
	const digest = hash(bytes);
	await storage.drafts.writeBlob(
		"d",
		1,
		"blob",
		digest,
		bytes.toString("base64"),
	);
	const next = await storage.filesystem.current();
	await writeFile(
		join(
			next.directory,
			next.state.folderName,
			".artisan",
			"drafts",
			"d",
			"blobs",
			digest,
		),
		"corrupt",
	);
	expect(await storage.drafts.readBlob("d", digest)).toMatchObject({
		result: { ok: false, error: "invalid_blob" },
	});
});
