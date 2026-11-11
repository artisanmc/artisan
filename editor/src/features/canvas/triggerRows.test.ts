import { resetDocumentKinds } from "@/domain/documentKinds";
import type { Project, ProjectId } from "@/domain/types";
import { registerEditorModule } from "@/lib/moduleDocumentKinds";
import { triggersModule } from "@/modules/triggers";
import { triggerFromFile } from "@/modules/triggers/trigger";
import { resetDocumentCodecs } from "@/schema/documentCodecs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearRegistry } from "../../../packages/editor-sdk/src/contract/registry";
import { deriveEdges } from "./deriveEdges";
import { TRIGGER_ROWS, documentBoxSize, triggerBox, triggerRowY } from "./menuLayout";
import { triggerRowsOpening, triggerStepAnchors } from "./subCommandAnchors";

const PID = "p1" as ProjectId;

/** `welcome` greets, opens `main`, then two more steps; the last opens `claims`. */
const welcome = (steps: unknown[] = []) =>
  triggerFromFile(
    {
      id: "welcome",
      on: "player_first_join",
      do: steps.length
        ? steps
        : [
            { send_message: "Hi" },
            { open_menu: "main" },
            { send_message: "Bye" },
            { send_message: "Again" },
            { open_menu: "claims" },
          ],
    },
    { projectId: PID, lang: "en" },
  ).doc;

function board(): Project {
  return {
    id: PID,
    name: "p",
    canvasLayout: {},
    i18nKeys: {},
    defaultLang: "en",
    documents: {
      menu: ["main", "claims"].map((id) => ({ id, rows: 3, layers: [] })),
      command: [],
      dialog: [],
      trigger: [welcome()],
    },
  } as unknown as Project;
}

describe("a trigger on the board", () => {
  beforeEach(() => registerEditorModule(triggersModule));
  afterEach(() => {
    clearRegistry();
    resetDocumentKinds();
    resetDocumentCodecs();
  });

  it("grows with the steps it shows, then a +N line", () => {
    const base = TRIGGER_ROWS.header + TRIGGER_ROWS.when + TRIGGER_ROWS.pad;
    expect(triggerBox(welcome([{ send_message: "Hi" }])).height).toBe(base + TRIGGER_ROWS.row);
    expect(triggerBox(welcome()).height).toBe(
      base + TRIGGER_ROWS.shown * TRIGGER_ROWS.row + TRIGGER_ROWS.more,
    );
    expect(documentBoxSize("trigger", welcome())).toEqual(triggerBox(welcome()));
  });

  it("finds the shown rows whose steps open a Document, never a hidden one", () => {
    expect(triggerRowsOpening(board(), welcome(), "menu/main")).toEqual([1]);
    expect(triggerRowsOpening(board(), welcome(), "menu/claims")).toEqual([]);
  });

  it("links a menu a shown step opens from that step's row", () => {
    const project = board();
    const src = { x: 0, y: 0, ...triggerBox(welcome()) };
    const boxes = {
      "trigger/welcome": src,
      "menu/main": { x: 400, y: 0, width: 200, height: 100 },
      "menu/claims": { x: 400, y: 300, width: 200, height: 100 },
    };
    const edges = deriveEdges(project);
    const anchors = triggerStepAnchors(project, edges, boxes);
    const main = edges.find((e) => e.target === "menu/main")!;
    const claims = edges.find((e) => e.target === "menu/claims")!;
    const rowMid = triggerRowY(1) + (TRIGGER_ROWS.row - 3) / 2;
    expect(anchors[main.id]).toEqual({ from: { side: "right", t: rowMid / src.height } });
    expect(anchors[claims.id]).toBeUndefined();
  });
});
