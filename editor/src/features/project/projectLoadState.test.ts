import type { Project } from "@/domain/types";
import { describe, expect, it } from "vitest";
import {
  type ProjectLoadEvent,
  type ProjectLoadState,
  initialProjectLoadState,
  projectLoadReducer,
  projectLoadStatus,
} from "./projectLoadState";

const project = { id: "p1", name: "Shop" } as unknown as Project;

function run(...events: ProjectLoadEvent[]): ProjectLoadState {
  return events.reduce(projectLoadReducer, initialProjectLoadState);
}

describe("projectLoadReducer", () => {
  it("opens from the server's disk: ready, validated", () => {
    const state = run(
      { type: "started", keepProject: false },
      { type: "located", scope: "s", id: "shop" },
      { type: "documentsFailed", failed: [{ path: "menus/x.yaml", reason: "bad" }] },
      { type: "opened", project, fromDraft: false },
      { type: "settled", since: undefined, unpublished: false },
      { type: "validated" },
    );
    expect(state).toMatchObject({
      project,
      resolvedUrl: { scope: "s", id: "shop" },
      error: null,
      offline: false,
      stale: false,
      offlineSince: null,
    });
    expect(state.failed).toHaveLength(1);
    expect(projectLoadStatus(state)).toBe("ready");
  });

  it("opens the hub's copy of an offline server dated, and the date survives a restart", () => {
    let state = run(
      { type: "started", keepProject: false },
      { type: "opened", project, fromDraft: true, failed: [] },
      { type: "settled", since: "2026-10-01T00:00:00Z", unpublished: true },
    );
    expect(state).toMatchObject({
      offline: true,
      stale: true,
      offlineSince: "2026-10-01T00:00:00Z",
      unpublished: true,
    });
    state = projectLoadReducer(state, { type: "started", keepProject: true });
    expect(state).toMatchObject({ project, offline: false, stale: false, fromDraft: false });
    expect(state.offlineSince).toBe("2026-10-01T00:00:00Z");
  });

  it("drops the previous project when the location changes", () => {
    const state = run(
      { type: "opened", project, fromDraft: false },
      { type: "started", keepProject: false },
    );
    expect(state.project).toBeNull();
    expect(projectLoadStatus(state)).toBe("loading");
  });

  it("keeps the open project when the connection is lost on a refresh", () => {
    const state = run({ type: "opened", project, fromDraft: true }, { type: "connectionLost" });
    expect(state).toMatchObject({ project, offline: true, stale: true, error: null });
  });

  it("a refused read hides the project and blocks the workspace", () => {
    const state = run(
      { type: "opened", project, fromDraft: false },
      { type: "readFailed", error: "plugin_update_required", offline: false },
    );
    expect(state.project).toBeNull();
    expect(projectLoadStatus(state)).toBe("error");
  });

  it("an unreachable first open is an offline error, not a stale copy", () => {
    const state = run(
      { type: "started", keepProject: false },
      { type: "loadFailed", error: "network_error", retrying: true },
    );
    expect(state).toMatchObject({ offline: true, stale: false, error: "network_error" });
  });

  it("a failure does not block a resumed draft", () => {
    const state = run(
      { type: "opened", project, fromDraft: true },
      { type: "loadFailed", error: "read_error", retrying: false },
    );
    expect(projectLoadStatus(state)).toBe("ready");
  });

  it("without a principal, says so", () => {
    expect(run({ type: "unauthenticated" }).error).toBe("Not authenticated");
  });
});
