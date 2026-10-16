import { MENU_KIND } from "@/domain/documentKinds";
import { menuChainSlots, visitMenuLTexts } from "@/domain/i18nSites";
import { newLayerId } from "@/domain/ids";
import { getFirstTitleText } from "@/domain/menuTitle";
import type { I18nKey, Menu, MenuId, Project, ProjectId } from "@/domain/types";
import { MenuProperties } from "@/features/canvas/properties/MenuProperties";
import { getText } from "@/lib/i18n";
import type { DocumentParseOpts } from "@/schema/documentCodecs";
import { menuV1FromDomain } from "@/schema/menuV1FromDomain";
import { menuV1ToDomain } from "@/schema/menuV1ToDomain";
import type { DocumentEditorProps, DocumentKindContribution } from "@artisan/editor-sdk";
import { LayoutGrid } from "lucide-react";

function MenuView({ projectId, document }: DocumentEditorProps) {
  return (
    <div className="p-3">
      <MenuProperties projectId={projectId as ProjectId} menu={document as Menu} />
    </div>
  );
}

/**
 * The menu kind, declared like a module's (ADR `extensible-document-kinds`, lot 5).
 * The board's in-place editing of a menu (slots, layers, drops from the library) is a
 * core exception outside this contract; see `editor-internals.md`.
 */
export const menuKind: DocumentKindContribution = {
  ...MENU_KIND,
  label: "projectPanel.menus",
  icon: LayoutGrid,
  component: MenuView,
  title: (doc, { project, lang }) => {
    const lt = getFirstTitleText(doc as Menu);
    return lt ? getText(project as Project, lt, lang) : "";
  },
  create: ({ id, projectId }) =>
    ({
      id: id as MenuId,
      projectId: projectId as ProjectId,
      // One plain title layer; its empty key is allocated by the host (`menus.<id>.title`).
      title: [{ kind: "plain", value: { key: "" as I18nKey } }],
      rows: 3,
      layers: [{ id: newLayerId(), name: "default", elements: [] }],
    }) satisfies Menu,
  parse: (src, ctx) => {
    const r = menuV1ToDomain(src, ctx as DocumentParseOpts);
    return { doc: r.menu, i18nKeys: r.i18nKeys, unsupported: r.unsupported };
  },
  serialize: (doc, project) => menuV1FromDomain(doc as Menu, project as Project),
  ltextSites: (doc) => visitMenuLTexts(doc as Menu),
  chainSlots: (doc) => menuChainSlots(doc as Menu),
};
