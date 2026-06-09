import type { ToolDef } from "./provider/types";
import { validateMenuV1 } from "./validate";
import type { WorkingCopy, MenuV1 } from "./workingCopy";

export type EngineEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string; ok: boolean; detail?: string }
  | { type: "menu_written"; menu: MenuV1 }
  | { type: "menu_deleted"; id: string }
  | { type: "usage"; usage: import("./provider/types").LlmUsage }
  | { type: "error"; message: string }
  | { type: "done"; stopReason: string };

export interface ToolResult { ok: boolean; content: string; event?: EngineEvent }

export const TOOL_DEFS: ToolDef[] = [
  { name: "list_menus", description: "List menus in the current pack (id, title, size).", parameters: { type: "object", properties: {}, additionalProperties: false } },
  { name: "get_menu", description: "Get a menu's full canonical menu/v1 JSON by id.", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false } },
  { name: "upsert_menu", description: "Create or replace a menu. The argument is a complete canonical menu/v1 object. Rejected with errors if invalid — fix and retry.", parameters: { type: "object", properties: { menu: { type: "object" } }, required: ["menu"], additionalProperties: false } },
  { name: "delete_menu", description: "Delete a menu by id.", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false } },
  { name: "read_attachment", description: "Read the raw text of a dropped zmenu/DeluxeMenus file by id.", parameters: { type: "object", properties: { file_id: { type: "string" } }, required: ["file_id"], additionalProperties: false } },
];

export function executeTool(name: string, input: any, wc: WorkingCopy): ToolResult {
  switch (name) {
    case "list_menus":
      return { ok: true, content: JSON.stringify(wc.list()) };
    case "get_menu": {
      const m = wc.get(String(input?.id));
      return m ? { ok: true, content: JSON.stringify(m) } : { ok: false, content: `No menu with id "${input?.id}".` };
    }
    case "upsert_menu": {
      const menu = input?.menu;
      const v = validateMenuV1(menu);
      if (!v.valid) return { ok: false, content: `Invalid menu/v1. Fix these and retry:\n- ${v.errors.join("\n- ")}` };
      wc.upsert(menu);
      return { ok: true, content: `Menu "${menu.id}" saved.`, event: { type: "menu_written", menu } };
    }
    case "delete_menu": {
      const id = String(input?.id);
      const existed = wc.delete(id);
      return existed
        ? { ok: true, content: `Menu "${id}" deleted.`, event: { type: "menu_deleted", id } }
        : { ok: false, content: `No menu with id "${id}".` };
    }
    case "read_attachment": {
      const txt = wc.attachment(String(input?.file_id));
      return txt !== undefined ? { ok: true, content: txt } : { ok: false, content: `No attachment "${input?.file_id}".` };
    }
    default:
      return { ok: false, content: `Unknown tool "${name}".` };
  }
}
