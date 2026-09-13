import { expect, test } from "bun:test";
import vectors from "../../../testdata/project-snapshot-hash-conformance.json";
import { computeBundleHash, computeProjectSnapshotHash } from "./hashUtils";
test("project read hash matches the shared Kotlin snapshot vectors", () => {
	for (const vector of vectors.cases)
		expect(
			computeProjectSnapshotHash(
				vector.files as Record<string, string>,
				vector.binaries as Record<string, string>,
				vector.failed as Record<string, string>,
			),
		).toBe(vector.hash);
	expect(computeBundleHash({})).toBe("");
	expect(computeProjectSnapshotHash({}, {})).not.toBe("");
});
