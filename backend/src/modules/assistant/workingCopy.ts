export type MenuV1 = Record<string, any>; // wire menu/v1 object
export type CommandV1 = Record<string, any>;
export type DialogV1 = Record<string, any>;

export interface DialogSummary { id: string; title: string }

/**
 * Une source de données visible depuis ce project — la sienne, ou celle qu'un
 * module a déclarée à la Presence (`boutique:items`…).
 *
 * En lecture seule : l'assistant écrit des menus, il ne déclare pas de sources.
 * Ce qu'il lui faut, c'est cesser de DEVINER si un `source.ref` existe.
 */
export interface DataSourceInfo {
  ref: string;
  moduleId?: string | null;
  /** "static" (placement 1 à 1 possible) ou "dynamic". */
  stability?: string | null;
  keyField?: string | null;
  fields?: { name: string; type?: string; description?: string }[];
}
export interface CommandSummary { id: string; name: string }

export class WorkingCopy {
  private menus = new Map<string, MenuV1>();
  private attachments = new Map<string, string>();
  private dialogs = new Map<string, DialogV1>();
  private commands = new Map<string, CommandV1>();
  /** i18n key → { lang: value } — the values behind `{i18n:<key>}` refs. */
  private translations = new Map<string, Record<string, string>>();

  /** Les sources visibles, telles qu'on les a reçues. */
  listDataSources(): DataSourceInfo[] {
    return this.dataSources;
  }

  constructor(
    menus: MenuV1[] = [],
    attachments: Record<string, string> = {},
    dialogs: DialogV1[] = [],
    commands: CommandV1[] = [],
    translations: Record<string, Record<string, string>> = {},
    private readonly dataSources: DataSourceInfo[] = [],
    private readonly previousResults: unknown[] = [],
  ) {
    for (const m of menus) if (typeof m?.id === "string") this.menus.set(m.id, m);
    for (const [k, v] of Object.entries(attachments)) this.attachments.set(k, v);
    for (const d of dialogs) if (typeof d?.id === "string") this.dialogs.set(d.id, d);
    for (const c of commands) if (typeof c?.id === "string") this.commands.set(c.id, c);
    for (const [k, v] of Object.entries(translations)) {
      if (v && typeof v === "object") this.translations.set(k, { ...v });
    }
  }

  list(): { id: string; title: unknown; size: number }[] {
    return [...this.menus.values()].map((m) => ({ id: m.id, title: m.title, size: m.size }));
  }
  get(id: string): MenuV1 | undefined { return this.menus.get(id); }
  upsert(menu: MenuV1): void { this.menus.set(menu.id, menu); }
  delete(id: string): boolean { return this.menus.delete(id); }

  listDialogs(): DialogSummary[] {
    return [...this.dialogs.values()].map((d) => ({ id: d.id, title: typeof d.title === "string" ? d.title : "" }));
  }
  getDialog(id: string): DialogV1 | undefined { return this.dialogs.get(id); }
  upsertDialog(d: DialogV1): void { this.dialogs.set(d.id, d); }
  deleteDialog(id: string): boolean { return this.dialogs.delete(id); }

  listCommands(): CommandSummary[] {
    return [...this.commands.values()].map((c) => ({ id: c.id, name: c.name }));
  }
  getCommand(id: string): CommandV1 | undefined { return this.commands.get(id); }
  upsertCommand(c: CommandV1): void { this.commands.set(c.id, c); }
  deleteCommand(id: string): boolean { return this.commands.delete(id); }

  attachment(fileId: string): string | undefined { return this.attachments.get(fileId); }
  attachmentIds(): string[] { return [...this.attachments.keys()]; }
  getPreviousResults(): unknown[] { return this.previousResults; }
  snapshot(): MenuV1[] { return [...this.menus.values()]; }

  /** Translations, optionally filtered by exact keys and/or a key prefix. */
  getTranslations(keys?: string[], prefix?: string): Record<string, Record<string, string>> {
    const wanted = keys && keys.length > 0 ? new Set(keys) : null;
    const out: Record<string, Record<string, string>> = {};
    for (const [k, v] of this.translations) {
      if (wanted && !wanted.has(k)) continue;
      if (prefix && !k.startsWith(prefix)) continue;
      out[k] = { ...v };
    }
    return out;
  }

  /** Merge per-key/per-lang values; creates keys as needed. Returns the merged key count. */
  setTranslations(entries: Record<string, Record<string, string>>): number {
    let n = 0;
    for (const [k, langs] of Object.entries(entries)) {
      const cur = this.translations.get(k) ?? {};
      this.translations.set(k, { ...cur, ...langs });
      n++;
    }
    return n;
  }
}
