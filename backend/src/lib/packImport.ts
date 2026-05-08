import { parse as parseYaml } from "yaml";

// ─── YAML schemas emitted by the plugin export ────────────────────────────────

interface ManifestYaml {
  pack_id?: string;
  default_lang?: string;
  files?: { menus?: string[]; commands?: string[]; dialogs?: string[] };
}

interface CommandYaml {
  id?: string;
  name?: string;
  aliases?: string[];
  permission?: string;
  description?: string;
  arguments?: Array<{ name: string; type?: string; required?: boolean; default?: string }>;
}

interface MenuYaml {
  id?: string;
  title?: string;
  rows?: number;
}

interface DialogYaml {
  id?: string;
  title?: string;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function getFile(files: Record<string, string>, packId: string, rel: string): string | null {
  return files[`plugins/Interfaze/packs/${packId}/${rel}`] ?? null;
}

function tryParse<T>(text: string | null): T | null {
  if (!text) return null;
  try { return parseYaml(text) as T; } catch { return null; }
}

// ─── public API ───────────────────────────────────────────────────────────────

/**
 * Build a minimal Pack editorJson from a set of compiled YAML files.
 * Steps are not restored (they'd require a full round-trip inverse that
 * doesn't exist). Commands and dialogs are stubs with empty step lists.
 */
export function importPackFromFiles(packId: string, files: Record<string, string>): Record<string, unknown> {
  const manifest = tryParse<ManifestYaml>(getFile(files, packId, "manifest.yaml")) ?? {};
  const defaultLang = manifest.default_lang ?? "en";
  const commandIds  = manifest.files?.commands ?? [];
  const dialogIds   = manifest.files?.dialogs  ?? [];
  const menuIds     = manifest.files?.menus    ?? [];
  const now         = new Date().toISOString();

  const commands = commandIds.map((cmdId) => {
    const y = tryParse<CommandYaml>(getFile(files, packId, `commands/${cmdId}.yaml`)) ?? {};
    return {
      id: y.id ?? cmdId,
      packId,
      name: y.name ?? cmdId,
      aliases: y.aliases ?? [],
      permission: y.permission,
      description: y.description,
      arguments: (y.arguments ?? []).map((a) => ({
        name: a.name,
        type: a.type ?? "string",
        required: a.required ?? false,
        default: a.default,
      })),
      steps: [],
    };
  });

  const dialogs = dialogIds.map((dlgId) => {
    const y = tryParse<DialogYaml>(getFile(files, packId, `dialogs/${dlgId}.yaml`)) ?? {};
    return {
      id: y.id ?? dlgId,
      packId,
      title: { key: `dialogs.${dlgId}.title` },
      canCloseWithEscape: true,
      body: [],
      inputs: [],
      buttons: [],
    };
  });

  const menus = menuIds.map((menuId) => {
    const y = tryParse<MenuYaml>(getFile(files, packId, `menus/${menuId}.yaml`)) ?? {};
    return {
      id: y.id ?? menuId,
      packId,
      title: { key: `menus.${menuId}.title` },
      rows: (y.rows ?? 3) as 1 | 2 | 3 | 4 | 5 | 6,
      layers: [{ id: `layer_default`, name: "Default", elements: [] }],
    };
  });

  return {
    id: packId,
    name: packId,
    source: "imported",
    createdAt: now,
    updatedAt: now,
    menus,
    commands,
    templates: [],
    assets: [],
    dataSources: [],
    dialogs,
    importedConnectors: [],
    i18nKeys: {},
    defaultLang,
    canvasLayout: {},
  };
}

/** Returns true if the editorJson looks like an auto-generated empty stub. */
export function isEmptyStub(editorJson: string | null | undefined): boolean {
  if (!editorJson) return true;
  try {
    const p = JSON.parse(editorJson) as { menus?: unknown[]; commands?: unknown[]; dialogs?: unknown[] };
    return (
      (p.menus?.length ?? 0) === 0 &&
      (p.commands?.length ?? 0) === 0 &&
      (p.dialogs?.length ?? 0) === 0
    );
  } catch { return true; }
}
