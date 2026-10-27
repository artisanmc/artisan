import type { Project, ProjectId } from "@/domain/types";
import { commandV1ToDomain } from "@/schema/commandV1ToDomain";
import { describe, expect, it } from "vitest";
import { deriveEdges } from "./deriveEdges";
import { COMMAND_BOX, COMMAND_ROWS, commandBox } from "./menuLayout";
import { commandRowRefs, rowsOpening, subCommandAnchors } from "./subCommandAnchors";

const PID = "auctions" as ProjectId;

/** `/ah` opens `main`; `/ah sell` runs nothing; `/ah claims` opens `claims`. */
const ah = () =>
  commandV1ToDomain(
    {
      schema: "command/v1",
      id: "ah",
      actions: [{ open_menu: "main" }],
      subcommands: [
        { name: "sell", subcommands: [{ name: "all", enabled: false }] },
        { name: "claims", actions: [{ open_menu: "claims" }] },
      ],
    },
    { projectId: PID, lang: "en" },
  ).command;

function board(): Project {
  return {
    id: PID,
    name: "auctions",
    canvasLayout: {},
    documents: {
      menu: ["main", "claims"].map((id) => ({ id, rows: 3, layers: [] })),
      command: [ah()],
      dialog: [],
    },
  } as unknown as Project;
}

describe("a command's sub-commands on the board", () => {
  it("grows its node by a row per sub-command, at any depth", () => {
    expect(commandBox({ ...ah(), subcommands: [] })).toEqual(COMMAND_BOX);
    expect(commandBox(ah()).height).toBe(
      COMMAND_ROWS.header + 3 * COMMAND_ROWS.row + COMMAND_ROWS.pad,
    );
  });

  it("reads the Documents each row's steps open", () => {
    expect(commandRowRefs(ah())).toEqual({ root: ["menu/main"], rows: [[], [], ["menu/claims"]] });
  });

  it("links a menu only a sub-command opens from that sub-command's row", () => {
    const project = board();
    const src = { x: 0, y: 0, ...commandBox(ah()) };
    const boxes = {
      "command/ah": src,
      "menu/claims": { x: 400, y: 0, width: 200, height: 100 },
      "menu/main": { x: 400, y: 300, width: 200, height: 100 },
    };
    const anchors = subCommandAnchors(project, deriveEdges(project), boxes);
    const rowMid = COMMAND_ROWS.header + 2 * COMMAND_ROWS.row + (COMMAND_ROWS.row - 3) / 2;
    expect(anchors).toEqual({
      "command/ah->menu/claims": { from: { side: "right", t: rowMid / src.height } },
    });
  });

  it("finds the rows a hovered link starts from", () => {
    expect(rowsOpening(board(), ah(), "menu/claims")).toEqual([2]);
    expect(rowsOpening(board(), ah(), "menu/main")).toEqual([]);
  });
});
