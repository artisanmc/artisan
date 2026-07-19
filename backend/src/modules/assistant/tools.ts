import type { ToolDef } from "./provider/types";
import { validateMenuV1, validateCommandV1, validateDialogV1 } from "./validate";
import type { WorkingCopy, MenuV1, CommandV1, DialogV1 } from "./workingCopy";

export type EngineEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string; ok: boolean; detail?: string }
  | { type: "menu_written"; menu: MenuV1 }
  | { type: "menu_deleted"; id: string }
  | { type: "command_written"; command: CommandV1 }
  | { type: "command_deleted"; id: string }
  | { type: "dialog_written"; dialog: DialogV1 }
  | { type: "dialog_deleted"; id: string }
  | { type: "translations_written"; entries: Record<string, Record<string, string>> }
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
  { name: "list_dialogs", description: "List the pack's dialogs (id, title). open_dialog's dialog_id MUST be one of these ids — never invent one.", parameters: { type: "object", properties: {}, additionalProperties: false } },
  { name: "list_commands", description: "List commands in the current pack (id, name).", parameters: { type: "object", properties: {}, additionalProperties: false } },
  { name: "get_command", description: "Get a command's full canonical command/v1 JSON by id.", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false } },
  { name: "upsert_command", description: "Create or replace a command. The argument is a complete canonical command/v1 object. Rejected with errors if invalid — fix and retry.", parameters: { type: "object", properties: { command: { type: "object" } }, required: ["command"], additionalProperties: false } },
  { name: "delete_command", description: "Delete a command by id.", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false } },
  { name: "get_translations", description: "Read the pack's i18n translation values (key → { lang: text }). Menus/dialogs reference text as {i18n:<key>} — this is how you see the actual text behind those refs. Optional filters: `keys` (exact key list) and/or `prefix` (e.g. \"item_templates.\"). No args = everything.", parameters: { type: "object", properties: { keys: { type: "array", items: { type: "string" } }, prefix: { type: "string" } }, additionalProperties: false } },
  { name: "write_translations", description: "Merge i18n translation values: { entries: { \"<key>\": { \"<lang>\": \"<text>\" } } }. Only the listed key/lang pairs change; other languages of the same key are preserved. Use existing keys from get_translations — never invent keys.", parameters: { type: "object", properties: { entries: { type: "object" } }, required: ["entries"], additionalProperties: false } },
  { name: "get_dialog", description: "Get a dialog's full canonical dialog/v1 JSON by id.", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false } },
  { name: "upsert_dialog", description: "Create or replace a dialog. The argument is a complete canonical dialog/v1 object. Rejected with errors if invalid — fix and retry.", parameters: { type: "object", properties: { dialog: { type: "object" } }, required: ["dialog"], additionalProperties: false } },
  { name: "delete_dialog", description: "Delete a dialog by id.", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false } },
];

export function executeTool(name: string, input: any, wc: WorkingCopy): ToolResult {
  switch (name) {
    case "list_menus":
      return { ok: true, content: JSON.stringify(wc.list()) };
    case "list_dialogs":
      return { ok: true, content: JSON.stringify(wc.listDialogs()) };
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
    case "list_commands":
      return { ok: true, content: JSON.stringify(wc.listCommands()) };
    case "get_command": {
      const c = wc.getCommand(String(input?.id));
      return c ? { ok: true, content: JSON.stringify(c) } : { ok: false, content: `No command with id "${input?.id}".` };
    }
    case "upsert_command": {
      const command = input?.command;
      const v = validateCommandV1(command);
      if (!v.valid) return { ok: false, content: `Invalid command/v1. Fix these and retry:\n- ${v.errors.join("\n- ")}` };
      wc.upsertCommand(command);
      return { ok: true, content: `Command "${command.id}" saved.`, event: { type: "command_written", command } };
    }
    case "delete_command": {
      const id = String(input?.id);
      return wc.deleteCommand(id)
        ? { ok: true, content: `Command "${id}" deleted.`, event: { type: "command_deleted", id } }
        : { ok: false, content: `No command with id "${id}".` };
    }
    case "get_translations": {
      const keys = Array.isArray(input?.keys) ? input.keys.map(String) : undefined;
      const prefix = typeof input?.prefix === "string" ? input.prefix : undefined;
      return { ok: true, content: JSON.stringify(wc.getTranslations(keys, prefix)) };
    }
    case "write_translations": {
      const entries = input?.entries;
      if (!entries || typeof entries !== "object" || Array.isArray(entries))
        return { ok: false, content: "`entries` must be an object: { \"<key>\": { \"<lang>\": \"<text>\" } }." };
      const clean: Record<string, Record<string, string>> = {};
      for (const [k, langs] of Object.entries(entries as Record<string, unknown>)) {
        if (!langs || typeof langs !== "object" || Array.isArray(langs))
          return { ok: false, content: `Value of key "${k}" must be an object { "<lang>": "<text>" }.` };
        const out: Record<string, string> = {};
        for (const [lang, v] of Object.entries(langs as Record<string, unknown>)) {
          if (typeof v !== "string")
            return { ok: false, content: `"${k}"."${lang}" must be a string.` };
          out[lang] = v;
        }
        clean[k] = out;
      }
      const n = wc.setTranslations(clean);
      return {
        ok: true,
        content: `${n} translation key(s) updated.`,
        event: { type: "translations_written", entries: clean },
      };
    }
    case "get_dialog": {
      const d = wc.getDialog(String(input?.id));
      return d ? { ok: true, content: JSON.stringify(d) } : { ok: false, content: `No dialog with id "${input?.id}".` };
    }
    case "upsert_dialog": {
      const dialog = input?.dialog;
      const v = validateDialogV1(dialog);
      if (!v.valid) return { ok: false, content: `Invalid dialog/v1. Fix these and retry:\n- ${v.errors.join("\n- ")}` };
      wc.upsertDialog(dialog);
      return { ok: true, content: `Dialog "${dialog.id}" saved.`, event: { type: "dialog_written", dialog } };
    }
    case "delete_dialog": {
      const id = String(input?.id);
      return wc.deleteDialog(id)
        ? { ok: true, content: `Dialog "${id}" deleted.`, event: { type: "dialog_deleted", id } }
        : { ok: false, content: `No dialog with id "${id}".` };
    }
    default:
      return { ok: false, content: `Unknown tool "${name}".` };
  }
}
