import { actionDocumentRefs } from "@/domain/actionArgs";
import { commandStepLists } from "@/domain/commandNodes";
import {
  commandsOf,
  docKey,
  menusOf,
  mutableMenus,
  renamedDocumentFiles,
} from "@/domain/documents";
import { addressedAppearances } from "@/domain/element";
import { rekeyMenu } from "@/domain/i18nSites";
import { newElementId, newLayerId } from "@/domain/ids";
import { walkActions } from "@/domain/stepPath";
import type {
  Action,
  CapturedItem,
  CapturedItemId,
  ContextInput,
  I18nKey,
  InventoryType,
  MenuId,
  MenuTitleLayer,
  ProjectId,
  SourceRef,
} from "@/domain/types";
import { slotCount } from "@/features/canvas/inventoryTypes";
import { createLTextAt, deleteLText, setLText } from "@/lib/i18n";
import { menuTitleKey } from "@/lib/i18nKeys";
import { parsePositions } from "@/lib/positions";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import {
  defaultIterateRange,
  renameBoardKey,
  shiftPlayerPositions,
  titleLayerKeys,
} from "./helpers";
import type { MenuRows, ProjectsSliceContext, ProjectsState } from "./types";

/** Menus as Documents: fields, title layers, context inputs, captured items, ids. */
export interface MenusSlice {
  /**
   * Create a new menu in `projectId` with sensible defaults (rows=3, single
   * default layer, no elements). Optional canvas position; falls back to
   * autoLayout's grid if omitted. Returns the new id so callers can route
   * to it.
   */
  createMenu: (input: {
    projectId: ProjectId;
    id: string;
    rows?: MenuRows;
    position?: { x: number; y: number };
  }) => MenuId;
  setMenuField: (input: {
    projectId: ProjectId;
    menuId: MenuId;
    field: "permission" | "rows" | "inventoryType" | "playerInventory" | "vanillaTexture";
    value: string | MenuRows | boolean;
  }) => void;
  /** Update the menu's title in the given language. Writes into the first text layer (or prepends one). */
  setMenuTitle: (input: {
    projectId: ProjectId;
    menuId: MenuId;
    lang: string;
    value: string;
  }) => void;
  /** Replace the entire title layer array. */
  setMenuTitleLayers: (input: {
    projectId: ProjectId;
    menuId: MenuId;
    layers: MenuTitleLayer[];
  }) => void;
  /** Patch a single title layer by index. */
  updateMenuTitleLayer: (input: {
    projectId: ProjectId;
    menuId: MenuId;
    index: number;
    patch: Partial<MenuTitleLayer>;
  }) => void;
  /** Append a new title layer. */
  addMenuTitleLayer: (input: {
    projectId: ProjectId;
    menuId: MenuId;
    layer: MenuTitleLayer;
  }) => void;
  /** Remove the title layer at `index`. */
  removeMenuTitleLayer: (input: { projectId: ProjectId; menuId: MenuId; index: number }) => void;
  /** Move a title layer from `fromIndex` to `toIndex`. */
  reorderMenuTitleLayers: (input: {
    projectId: ProjectId;
    menuId: MenuId;
    fromIndex: number;
    toIndex: number;
  }) => void;
  /** Append a new context input to a menu (auto-named ctxN). */
  addMenuContextInput: (input: {
    projectId: ProjectId;
    menuId: MenuId;
    kind?: "primitive" | "sourceRef";
  }) => void;
  setMenuContextInput: (input: {
    projectId: ProjectId;
    menuId: MenuId;
    index: number;
    input: ContextInput;
  }) => void;
  removeMenuContextInput: (input: { projectId: ProjectId; menuId: MenuId; index: number }) => void;
  /** Captured items — upsert by id (a re-capture replaces the entry). */
  addCapturedItem: (input: { projectId: ProjectId; item: CapturedItem }) => void;
  removeCapturedItem: (input: { projectId: ProjectId; itemId: CapturedItemId }) => void;
  /**
   * Create THE item set of one menu list (menu data section) — a
   * SELF-CONTAINED element (no Item template): appearances seeded from the
   * source's schema heuristics (icon/name/price), i18n minted canonically.
   * `iterates` auto-fills a slot range; `places` starts empty and is fed by
   * the contextual placement panel. One set per (menu, list).
   */
  createMenuSet: (input: {
    projectId: ProjectId;
    menuId: MenuId;
    inputName: string;
    mode: "iterates" | "places";
    keyField?: string;
    alias?: string;
    schema: { name: string }[];
    positions?: string;
  }) => { ok: true; elementId: string } | { ok: false; reason: "not_found" | "already_exists" };
  /**
   * Rename a menu's id. Rejects if newId already exists in the project.
   * Atomically rewrites all `open_menu` refs in the project and the
   * canvasLayout key. Cross-project refs to this menu (which we don't track)
   * become dangling — runtime handles.
   */
  setMenuId: (input: { projectId: ProjectId; oldId: MenuId; newId: MenuId }) => void;
}

export const createMenusSlice = ({
  get,
  mutateProject,
  mutateMenu,
}: ProjectsSliceContext): MenusSlice => ({
  createMenu: ({ projectId: pId, id: rawId, rows, position }) => {
    const id = rawId as MenuId;
    mutateProject(pId, (project) => {
      mutableMenus(project).push({
        id,
        projectId: pId,
        // Default to a single Plain (vanilla) title layer. Vanilla mode
        // works without a resource project and matches what new users expect
        // ("type a title, see a title"). The empty `key` is rekeyed to
        // `menus.{id}.title` at deploy time by rekeyProject.
        title: [{ kind: "plain", value: { key: "" as I18nKey } }],
        rows: rows ?? 3,
        layers: [{ id: newLayerId(), name: "default", elements: [] }],
      });
      if (position) {
        project.canvasLayout[docKey("menu", id)] = position;
      }
    });
    return id;
  },
  setMenuField: ({ projectId: pId, menuId: mId, field, value }) =>
    mutateMenu(pId, mId, (menu) => {
      if (field === "permission") {
        if (typeof value !== "string") return false;
        menu.permission = value || undefined;
      } else if (field === "rows") {
        if (typeof value !== "number") return false;
        const type = menu.inventoryType ?? "chest";
        const oldSize = slotCount(type, menu.rows);
        const maxPos = slotCount(type, value) - 1;
        // Player slots (hidden bottom) follow the resize: only menu positions can overflow.
        const menuLimit = menu.playerInventory === "hidden" ? oldSize : Number.POSITIVE_INFINITY;
        const overflow = menu.layers.some((l) =>
          l.elements.some((el) =>
            parsePositions(el.positions).some((p) => p > maxPos && p < menuLimit),
          ),
        );
        if (overflow) {
          throw new Error(`cannot shrink to ${value} rows: elements exist past position ${maxPos}`);
        }
        shiftPlayerPositions(menu, oldSize, slotCount(type, value));
        menu.rows = value;
      } else if (field === "playerInventory") {
        menu.playerInventory = value === "hidden" ? "hidden" : undefined;
      } else if (field === "vanillaTexture") {
        menu.vanillaTexture = value === false ? false : undefined;
      } else if (field === "inventoryType") {
        if (typeof value !== "string") return false;
        shiftPlayerPositions(
          menu,
          slotCount(menu.inventoryType ?? "chest", menu.rows),
          slotCount(value as InventoryType, menu.rows),
        );
        // Keep+warn: never throw on out-of-range elements; the UI surfaces
        // a count and the canvas/export clamp to the new slotCount. Store
        // undefined for chest so "absent = chest" everywhere.
        menu.inventoryType = value === "chest" ? undefined : (value as InventoryType);
      }
    }),
  setMenuTitle: ({ projectId: pId, menuId: mId, lang, value }) =>
    mutateMenu(pId, mId, (menu, project) => {
      // menu.title is MenuTitleLayer[]. Write into the first text-bearing
      // layer (plain, text, or textarea) if present; otherwise prepend a
      // new text layer. Plain is the createMenu default (vanilla mode),
      // so the most common path is "write into the plain layer's LText".
      const first = menu.title[0];
      if (first && (first.kind === "plain" || first.kind === "text" || first.kind === "textarea")) {
        // Empty-key sentinel from createMenu default: allocate a canonical key.
        if (first.value.key === "") {
          const newLText = createLTextAt(project, menuTitleKey(mId), value, lang);
          first.value = newLText;
        } else {
          setLText(project, first.value, lang, value);
        }
      } else {
        const newLText = createLTextAt(project, menuTitleKey(mId), value, lang);
        menu.title.unshift({ kind: "text", value: newLText, x: 8, y: 5 });
      }
    }),
  setMenuTitleLayers: ({ projectId: pId, menuId: mId, layers }) =>
    mutateMenu(pId, mId, (menu, project) => {
      // Release the i18n keys of text-bearing layers that the new layer
      // set drops, so switching title modes (composed ↔ vanilla) doesn't
      // leak orphaned "(unused)" keys. Keys kept in `layers` (e.g. a
      // migrated title) are preserved.
      const keptKeys = titleLayerKeys(layers);
      for (const key of titleLayerKeys(menu.title)) {
        if (!keptKeys.has(key)) deleteLText(project, { key });
      }
      menu.title = layers;
    }),
  updateMenuTitleLayer: ({ projectId: pId, menuId: mId, index, patch }) =>
    mutateMenu(pId, mId, (menu) => {
      const layer = menu.title[index];
      if (!layer) return false;
      menu.title[index] = { ...layer, ...patch } as MenuTitleLayer;
    }),
  addMenuTitleLayer: ({ projectId: pId, menuId: mId, layer }) =>
    mutateMenu(pId, mId, (menu) => {
      menu.title.push(layer);
    }),
  removeMenuTitleLayer: ({ projectId: pId, menuId: mId, index }) =>
    mutateMenu(pId, mId, (menu, project) => {
      const [removed] = menu.title.splice(index, 1);
      // GC the removed layer's i18n key (text-bearing layers only) so a
      // deleted title layer doesn't leave an orphaned "(unused)" key.
      if (removed) {
        for (const key of titleLayerKeys([removed])) deleteLText(project, { key });
      }
    }),
  reorderMenuTitleLayers: ({ projectId: pId, menuId: mId, fromIndex, toIndex }) =>
    mutateMenu(pId, mId, (menu) => {
      const [moved] = menu.title.splice(fromIndex, 1);
      if (moved) menu.title.splice(toIndex, 0, moved);
    }),
  addMenuContextInput: ({ projectId: pId, menuId: mId, kind }) =>
    mutateMenu(pId, mId, (menu) => {
      if (!menu.contextInputs) menu.contextInputs = [];
      const used = new Set(menu.contextInputs.map((c) => c.name));
      const defaultName = (() => {
        for (let i = 1; ; i++) {
          const candidate = `ctx${i}`;
          if (!used.has(candidate)) return candidate;
        }
      })();
      const newInput: ContextInput =
        kind === "sourceRef"
          ? { kind: "sourceRef", name: defaultName, ref: "" as SourceRef }
          : { kind: "primitive", name: defaultName, type: "string" };
      menu.contextInputs.push(newInput);
    }),
  setMenuContextInput: ({ projectId: pId, menuId: mId, index, input }) =>
    mutateMenu(pId, mId, (menu) => {
      if (!menu.contextInputs) return false;
      if (index < 0 || index >= menu.contextInputs.length) return false;
      menu.contextInputs[index] = input;
    }),
  removeMenuContextInput: ({ projectId: pId, menuId: mId, index }) =>
    mutateMenu(pId, mId, (menu) => {
      if (!menu.contextInputs) return false;
      if (index < 0 || index >= menu.contextInputs.length) return false;
      menu.contextInputs.splice(index, 1);
      if (menu.contextInputs.length === 0) menu.contextInputs = undefined;
    }),
  addCapturedItem: ({ projectId: pId, item }) =>
    mutateProject(pId, (project) => {
      if (!project.capturedItems) project.capturedItems = [];
      const i = project.capturedItems.findIndex((c) => c.id === item.id);
      if (i >= 0) project.capturedItems[i] = item;
      else project.capturedItems.push(item);
    }),
  removeCapturedItem: ({ projectId: pId, itemId }) =>
    mutateProject(pId, (project) => {
      if (!project.capturedItems) return false;
      project.capturedItems = project.capturedItems.filter((c) => c.id !== itemId);
    }),
  createMenuSet: ({
    projectId: pId,
    menuId: mId,
    inputName,
    mode,
    keyField,
    alias: aliasIn,
    schema,
    positions,
  }) => {
    let result: ReturnType<ProjectsState["createMenuSet"]> = { ok: false, reason: "not_found" };
    mutateMenu(
      pId,
      mId,
      (menu, project) => {
        // `inputName` may be a DOTTED PATH into an object param (e.g.
        // `category.items`) — the guard checks the ROOT input exists.
        const rootName = inputName.split(".")[0]!;
        const input = menu.contextInputs?.find((c) => c.name === rootName);
        if (!input) return;
        const consumed = menu.layers
          .flatMap((l) => l.elements)
          .some((e) => e.iterates?.source === inputName || e.places?.source === inputName);
        if (consumed) {
          result = { ok: false, reason: "already_exists" };
          return;
        }
        const alias = aliasIn ?? "item";
        const has = (names: string[]) => names.find((n) => schema.some((f) => f.name === n));
        const iconField = has(["icon", "material"]);
        const nameField = has(["name", "title", "label"]) ?? keyField ?? schema[0]?.name;
        const loreField = has(["final_price", "price", "description", "lore"]);

        const elId = newElementId();
        // Canonical element key sites from the start — no later rekey churn.
        const titleKey = `menus.${mId}.elements.${elId}.default.title` as I18nKey;
        const loreKey = `menus.${mId}.elements.${elId}.default.lore` as I18nKey;
        project.i18nKeys[titleKey] = {
          [project.defaultLang]: nameField ? `{${alias}.${nameField}}` : "",
        };
        if (loreField)
          project.i18nKeys[loreKey] = { [project.defaultLang]: `{${alias}.${loreField}}` };

        if (menu.layers.length === 0)
          menu.layers.push({ id: newLayerId(), name: "default", elements: [] });
        menu.layers[0]!.elements.push({
          id: elId,
          positions: mode === "iterates" ? (positions ?? defaultIterateRange(menu)) : "",
          display: {
            material: iconField ? `{${alias}.${iconField}}` : "CHEST",
            title: { key: titleKey },
            ...(loreField ? { lore: { key: loreKey } } : {}),
          },
          states: [],
          ...(mode === "iterates"
            ? { iterates: { source: inputName, alias } }
            : {
                places: {
                  source: inputName,
                  alias,
                  keyField: keyField ?? "id",
                  placements: [],
                },
              }),
        });
        result = { ok: true, elementId: elId };
      },
      // This action has never stamped `updatedAt`; kept as is.
      { touch: false },
    );
    return result;
  },
  setMenuId: ({ projectId: pId, oldId, newId }) => {
    if (oldId === newId) return;
    if (!newId) throw new Error("menu id cannot be empty");
    {
      const project = get().openProjects.projects.find((p) => p.id === pId);
      if (!project) return;
      if (menusOf(project).some((m) => m.id === newId)) {
        throw new Error(`menu id "${newId}" already exists in project`);
      }
      if (!menusOf(project).some((m) => m.id === oldId)) return;
    }
    mutateMenu(pId, oldId, (menu, project) => {
      menu.id = newId;
      // Rewrite open_menu refs across the entire project — both
      // element click handlers and command step trees.
      const rewrite = (action: Action) => {
        for (const ref of actionDocumentRefs(action)) {
          if (ref.document === "menu" && ref.id === oldId) ref.set(newId);
        }
      };
      for (const m of menusOf(project)) {
        for (const layer of m.layers) {
          for (const el of layer.elements) {
            for (const appearance of addressedAppearances(el)) {
              if (!appearance.click) continue;
              for (const handler of Object.values(appearance.click)) {
                if (!handler) continue;
                for (const a of walkActions(handler.steps)) rewrite(a);
              }
            }
          }
        }
      }
      for (const cmd of commandsOf(project)) {
        for (const steps of commandStepLists(cmd)) for (const a of walkActions(steps)) rewrite(a);
      }
      renameBoardKey(project, "menu", oldId, newId);
      rekeyMenu(project, menu);
    });
    // Same intent as setDialogId, recorded once the rename is applied.
    const moved = renamedDocumentFiles(
      get().openProjects.projects.find((p) => p.id === pId),
      "menu",
      oldId as string,
      newId as string,
    );
    useProjectDraftStore.getState().recordRename(pId, moved.from, moved.to);
  },
});
