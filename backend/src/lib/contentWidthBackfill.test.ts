import { describe, expect, it } from "vitest";
import { backfillContentWidths } from "./contentWidthBackfill";

describe("backfillContentWidths", () => {
  it("runs without throwing (valid select)", async () => {
    // Regression: the select referenced a nonexistent `assets.serverKeyId`
    // column (the table is keyed by projectId), so Drizzle threw on undefined
    // select fields at backend startup. The failure is at query construction,
    // independent of rows — so we neither seed nor clear assets here (a global
    // `db.delete(assets)` would race parallel asset tests on the shared test DB).
    await expect(backfillContentWidths()).resolves.toBeUndefined();
  });
});
