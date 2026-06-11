export type MenuV1 = Record<string, any>; // wire menu/v1 object

export interface DialogSummary { id: string; title: string }

export class WorkingCopy {
  private menus = new Map<string, MenuV1>();
  private attachments = new Map<string, string>();
  private dialogs: DialogSummary[] = [];

  constructor(
    menus: MenuV1[] = [],
    attachments: Record<string, string> = {},
    dialogs: DialogSummary[] = [],
  ) {
    for (const m of menus) if (typeof m?.id === "string") this.menus.set(m.id, m);
    for (const [k, v] of Object.entries(attachments)) this.attachments.set(k, v);
    this.dialogs = dialogs.filter((d) => typeof d?.id === "string");
  }
  list(): { id: string; title: unknown; size: number }[] {
    return [...this.menus.values()].map((m) => ({ id: m.id, title: m.title, size: m.size }));
  }
  listDialogs(): DialogSummary[] {
    return this.dialogs;
  }
  get(id: string): MenuV1 | undefined { return this.menus.get(id); }
  upsert(menu: MenuV1): void { this.menus.set(menu.id, menu); }
  delete(id: string): boolean { return this.menus.delete(id); }
  attachment(fileId: string): string | undefined { return this.attachments.get(fileId); }
  snapshot(): MenuV1[] { return [...this.menus.values()]; }
}
