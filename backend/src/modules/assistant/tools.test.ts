import { describe, expect, it } from "bun:test";
import { TOOL_DEFS, executeTool } from "./tools";
import { WorkingCopy } from "./workingCopy";

const validMenu = {
  schema: "menu/v1", id: "shop", title: [{ kind: "plain", value: { key: "k" } }], size: 27,
  layers: [{ id: "l1", name: "default", elements: [{ id: "e1", positions: "0", appearances: [{ material: "STONE" }] }] }],
};

describe("TOOL_DEFS", () => {
  it("declares the menu/dialog/command tools with JSON-Schema parameters", () => {
    const names = TOOL_DEFS.map((t) => t.name).sort();
    expect(names).toEqual([
      "delete_command", "delete_dialog", "delete_menu",
      "get_command", "get_dialog", "get_menu", "get_translations",
      "list_commands", "list_dialogs", "list_menus",
      "read_attachment",
      "upsert_command", "upsert_dialog", "upsert_menu",
      "write_translations",
    ]);
    for (const t of TOOL_DEFS) {
      expect(typeof t.description).toBe("string");
      expect(t.parameters).toMatchObject({ type: "object" });
    }
  });
});

describe("executeTool", () => {
  it("upsert_menu rejects an invalid menu (gate) and does not write", () => {
    const wc = new WorkingCopy();
    const r = executeTool("upsert_menu", { menu: { ...validMenu, size: 13 } }, wc);
    expect(r.ok).toBe(false);
    expect(r.event).toBeUndefined();
    expect(r.content).toMatch(/size/);
    expect(wc.get("shop")).toBeUndefined();
  });

  it("upsert_menu accepts a valid menu, emits menu_written, and stores it", () => {
    const wc = new WorkingCopy();
    const r = executeTool("upsert_menu", { menu: validMenu }, wc);
    expect(r.ok).toBe(true);
    expect(r.event).toEqual({ type: "menu_written", menu: validMenu });
    expect(wc.get("shop")).toEqual(validMenu);
  });

  it("get_menu returns the menu JSON or an error when missing", () => {
    const wc = new WorkingCopy([validMenu]);
    const hit = executeTool("get_menu", { id: "shop" }, wc);
    expect(hit.ok).toBe(true);
    expect(JSON.parse(hit.content)).toEqual(validMenu);
    const miss = executeTool("get_menu", { id: "nope" }, wc);
    expect(miss.ok).toBe(false);
    expect(miss.content).toMatch(/nope/);
  });

  it("list_menus returns id/title/size for each menu", () => {
    const wc = new WorkingCopy([validMenu]);
    const r = executeTool("list_menus", {}, wc);
    expect(r.ok).toBe(true);
    expect(JSON.parse(r.content)).toEqual([{ id: "shop", title: validMenu.title, size: 27 }]);
  });

  it("delete_menu removes a menu and emits menu_deleted, or errors when missing", () => {
    const wc = new WorkingCopy([validMenu]);
    const r = executeTool("delete_menu", { id: "shop" }, wc);
    expect(r.ok).toBe(true);
    expect(r.event).toEqual({ type: "menu_deleted", id: "shop" });
    expect(wc.get("shop")).toBeUndefined();
    const again = executeTool("delete_menu", { id: "shop" }, wc);
    expect(again.ok).toBe(false);
  });

  it("read_attachment returns raw text or an error when missing", () => {
    const wc = new WorkingCopy([], { "f1": "menus:\n  shop: {}" });
    const hit = executeTool("read_attachment", { file_id: "f1" }, wc);
    expect(hit.ok).toBe(true);
    expect(hit.content).toBe("menus:\n  shop: {}");
    const miss = executeTool("read_attachment", { file_id: "f2" }, wc);
    expect(miss.ok).toBe(false);
  });

  it("list_dialogs returns the pack's dialogs (id + title)", () => {
    const wc = new WorkingCopy([], {}, [{ id: "confirm", title: "Confirm purchase" }]);
    const r = executeTool("list_dialogs", {}, wc);
    expect(r.ok).toBe(true);
    expect(JSON.parse(r.content)).toEqual([{ id: "confirm", title: "Confirm purchase" }]);
  });

  it("list_dialogs returns an empty list when the pack has no dialogs", () => {
    const r = executeTool("list_dialogs", {}, new WorkingCopy());
    expect(r.ok).toBe(true);
    expect(JSON.parse(r.content)).toEqual([]);
  });

  it("returns an error for an unknown tool", () => {
    const r = executeTool("nope", {}, new WorkingCopy());
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/Unknown tool/);
  });
});

describe("command tools", () => {
  const cmd = { schema: "command/v1", id: "heal", name: "heal", steps: "close_menu" };

  it("tool defs expose command CRUD", () => {
    const names = TOOL_DEFS.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["list_commands", "get_command", "upsert_command", "delete_command"]));
  });

  it("upsert_command validates then writes and emits command_written", () => {
    const wc = new WorkingCopy();
    const r = executeTool("upsert_command", { command: cmd }, wc);
    expect(r.ok).toBe(true);
    expect(r.event).toEqual({ type: "command_written", command: cmd });
    expect(wc.getCommand("heal")).toBeDefined();
  });

  it("upsert_command rejects invalid command with errors", () => {
    const wc = new WorkingCopy();
    const r = executeTool("upsert_command", { command: { schema: "command/v1", id: "x" } }, wc);
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/Invalid command/);
  });

  it("delete_command emits command_deleted", () => {
    const wc = new WorkingCopy([], {}, [], [cmd]);
    const r = executeTool("delete_command", { id: "heal" }, wc);
    expect(r.event).toEqual({ type: "command_deleted", id: "heal" });
  });
});

describe("dialog write tools", () => {
  const dlg = { schema: "dialog/v1", id: "d", title: "T", buttons: [{ id: "ok", label: "OK", actions: "close_dialog" }] };

  it("upsert_dialog validates and emits dialog_written", () => {
    const wc = new WorkingCopy();
    const r = executeTool("upsert_dialog", { dialog: dlg }, wc);
    expect(r.ok).toBe(true);
    expect(r.event).toEqual({ type: "dialog_written", dialog: dlg });
  });

  it("get_dialog returns the full object", () => {
    const wc = new WorkingCopy([], {}, [dlg]);
    const r = executeTool("get_dialog", { id: "d" }, wc);
    expect(JSON.parse(r.content).buttons[0].id).toBe("ok");
  });

  it("delete_dialog emits dialog_deleted", () => {
    const wc = new WorkingCopy([], {}, [dlg]);
    const r = executeTool("delete_dialog", { id: "d" }, wc);
    expect(r.event).toEqual({ type: "dialog_deleted", id: "d" });
  });

  it("get_translations reads all, by keys, and by prefix", () => {
    const wc = new WorkingCopy([], {}, [], [], {
      "menus.shop.title": { fr: "&6Boutique" },
      "item_templates.t1.default.title": { fr: "&f{item.name}", en: "{item.name}" },
    });
    const all = JSON.parse(executeTool("get_translations", {}, wc).content);
    expect(Object.keys(all)).toHaveLength(2);
    const byKey = JSON.parse(
      executeTool("get_translations", { keys: ["menus.shop.title"] }, wc).content,
    );
    expect(byKey).toEqual({ "menus.shop.title": { fr: "&6Boutique" } });
    const byPrefix = JSON.parse(
      executeTool("get_translations", { prefix: "item_templates." }, wc).content,
    );
    expect(Object.keys(byPrefix)).toEqual(["item_templates.t1.default.title"]);
  });

  it("write_translations merges per-lang and emits translations_written", () => {
    const wc = new WorkingCopy([], {}, [], [], {
      "menus.shop.title": { fr: "&6Boutique", en: "&6Shop" },
    });
    const r = executeTool(
      "write_translations",
      { entries: { "menus.shop.title": { fr: "<gold>Boutique" } } },
      wc,
    );
    expect(r.ok).toBe(true);
    expect(r.event).toEqual({
      type: "translations_written",
      entries: { "menus.shop.title": { fr: "<gold>Boutique" } },
    });
    // Other languages of the same key are preserved.
    expect(wc.getTranslations(["menus.shop.title"])).toEqual({
      "menus.shop.title": { fr: "<gold>Boutique", en: "&6Shop" },
    });
  });

  it("write_translations rejects malformed entries", () => {
    const wc = new WorkingCopy();
    expect(executeTool("write_translations", { entries: "nope" }, wc).ok).toBe(false);
    expect(executeTool("write_translations", { entries: { k: "nope" } }, wc).ok).toBe(false);
    expect(executeTool("write_translations", { entries: { k: { fr: 42 } } }, wc).ok).toBe(false);
  });
});
