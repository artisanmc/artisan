import { describe, expect, test } from "bun:test";
import { WorkingCopy } from "./workingCopy";

describe("WorkingCopy commands", () => {
  test("upsert/get/delete/list commands", () => {
    const wc = new WorkingCopy([], {}, [], [{ schema: "command/v1", id: "heal", name: "heal", steps: "close_menu" }]);
    expect(wc.listCommands()).toEqual([{ id: "heal", name: "heal" }]);
    expect((wc.getCommand("heal") as any).name).toBe("heal");
    wc.upsertCommand({ schema: "command/v1", id: "heal", name: "heal2", steps: "close_menu" });
    expect((wc.getCommand("heal") as any).name).toBe("heal2");
    expect(wc.deleteCommand("heal")).toBe(true);
    expect(wc.getCommand("heal")).toBeUndefined();
  });
});

describe("WorkingCopy dialogs (full objects)", () => {
  test("listDialogs derives id+title summary; getDialog returns full", () => {
    const wc = new WorkingCopy([], {}, [{ schema: "dialog/v1", id: "d", title: "Hi", buttons: [{ id: "ok", label: "OK" }] }]);
    expect(wc.listDialogs()).toEqual([{ id: "d", title: "Hi" }]);
    expect((wc.getDialog("d") as any).buttons[0].id).toBe("ok");
    wc.upsertDialog({ schema: "dialog/v1", id: "d2", title: "Yo", buttons: [] });
    expect(wc.listDialogs().map((x) => x.id).sort()).toEqual(["d", "d2"]);
    expect(wc.deleteDialog("d")).toBe(true);
  });
});
