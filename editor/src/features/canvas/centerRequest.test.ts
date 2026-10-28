import type { Project } from "@/domain/types";
import { describe, expect, it } from "vitest";
import { viewportForCenterRequest } from "./centerRequest";
import { centerViewport } from "./focusViewport";
import { COMMAND_BOX } from "./menuLayout";

const project = {
  id: "p1",
  documents: {
    menu: [],
    command: [{ id: "cmd", name: "cmd", arguments: [], steps: [] }],
    dialog: [],
  },
} as unknown as Project;
const layout = { "command/cmd": { x: 400, y: 200 } };
const size = { w: 1200, h: 900 };

describe("viewportForCenterRequest", () => {
  it("frames the requested document of this board", () => {
    const v = viewportForCenterRequest(
      { projectId: "p1", docId: "command/cmd", nonce: 1 },
      "p1",
      project,
      layout,
      size,
    );
    expect(v).toEqual(centerViewport(size, { x: 400, y: 200, ...COMMAND_BOX }));
  });

  it("ignores a request meant for another project's board", () => {
    expect(
      viewportForCenterRequest(
        { projectId: "p2", docId: "cmd", nonce: 1 },
        "p1",
        project,
        layout,
        size,
      ),
    ).toBeNull();
  });

  it("waits while the board has no size or the document is not laid out yet", () => {
    const req = { projectId: "p1", docId: "cmd", nonce: 1 };
    expect(viewportForCenterRequest(req, "p1", project, layout, { w: 0, h: 0 })).toBeNull();
    expect(viewportForCenterRequest(req, "p1", project, {}, size)).toBeNull();
  });

  it("does nothing without a request", () => {
    expect(viewportForCenterRequest(null, "p1", project, layout, size)).toBeNull();
  });
});
