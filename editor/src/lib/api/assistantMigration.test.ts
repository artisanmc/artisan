import { afterEach, expect, it, vi } from "vitest";
import {
	MigrationRequestError,
	controlMigration,
	createMigration,
	listMigrations,
} from "./assistantMigration";

afterEach(() => vi.unstubAllGlobals());
it("discovers durable runs with a cancellable credentialed GET and never starts work", async () => {
	const fetcher = vi.fn(async () => Response.json({ runs: [] }));
	vi.stubGlobal("fetch", fetcher);
	const signal = new AbortController().signal;
	expect(await listMigrations("c/id", signal)).toEqual([]);
	expect(fetcher).toHaveBeenCalledWith(
		expect.stringContaining("c%2Fid/migrations"),
		expect.objectContaining({ credentials: "include", signal }),
	);
	expect(fetcher.mock.calls).toHaveLength(1);
});
it("sends explicit analysis and revision-bound controls without retrying conflicts", async () => {
	const fetcher = vi
		.fn()
		.mockResolvedValueOnce(Response.json({ run: { id: "r" } }))
		.mockResolvedValueOnce(
			Response.json({ error: "revision_conflict" }, { status: 409 }),
		);
	vi.stubGlobal("fetch", fetcher);
	const input = {
		requestId: "request",
		modelId: "model",
		existingTargetIds: [],
		serverAttachments: [{ sourceId: "z", paths: ["a.yml"] }],
	};
	expect(await createMigration("c", input)).toEqual({ id: "r" });
	await expect(controlMigration("c", "r", "resume", 4)).rejects.toBeInstanceOf(
		MigrationRequestError,
	);
	expect(fetcher).toHaveBeenCalledTimes(2);
	expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
		expectedRevision: 4,
	});
});
