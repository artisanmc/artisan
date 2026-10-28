import type { ComponentType, ReactNode } from "react";

/**
 * A Document kind a module contributes to the editor (ADR `extensible-document-kinds`,
 * lot 5). The host keeps Documents of every kind in `project.documents[kind]` and reads
 * everything it needs about a kind here: its folder and id prefix, its file codec, its
 * edit view, where its texts and action chains live. The core kinds (menu, command,
 * dialog) are declared the same way by the core modules.
 *
 * Document values are `unknown` on this side: the contract compiles without the host's
 * domain types, and each kind knows the shape of its own documents.
 */
export interface DocumentKindContribution {
  /** The kind id, also the key of `project.documents` ("quest"). */
  kind: string;
  /** Folder of the kind inside a project, without slash ("quests"). */
  dir: string;
  /** `schema:` written in a new file of this kind ("quest/v1"). */
  schemaVersion: string;
  /** Prefix of a freshly minted id ("quest_"); absent = ids are typed by hand. */
  idPrefix?: string;
  /** Rank of the kind's orphans in the board gutter; lower first (core kinds: 0, 1, 2). */
  rank?: number;
  /**
   * The project folders (their disk ids) where a Document of this kind may be created (SDK
   * 1.8); every project when absent. A kind that only means something beside its module's own
   * content (a shop's categories, read from the shop's folder only) lists that folder. Files
   * already in another project are still read and shown: only creation is refused.
   */
  projects?: string[];
  /**
   * The kind's Documents form one collection (SDK 1.9): a shop's catalogue, its categories.
   * The host shows them in a single container instead of the board: one sidebar entry and
   * one page listing them, with a button to create one. They stay at the project's root
   * (never in a themed folder) and get no board node; a Document opens on its own view.
   * Meant for kinds that are data, with no links to or from other Documents.
   */
  collection?: DocumentCollection;
  /** The kind's plural name in the registry and the "New …" menu: an i18n key of the host, or a literal. */
  label: string;
  /** The same name per interface language (`{ en, fr }`): a module carries its own; wins over `label`. */
  labels?: Record<string, string>;
  /** Icon of the kind in the registry; the host has a default. */
  icon?: ComponentType<{ className?: string }>;
  /**
   * The edit view of a selected Document of this kind, in the Properties panel. Every
   * kind edits there; the menu's in-place editing on the board is a core exception
   * (`editor-internals.md`), not part of this contract.
   */
  component: ComponentType<DocumentEditorProps>;
  /**
   * `component` draws the Document's header itself (SDK 1.13): the host then leaves out its
   * own (the kind's tile, its name, the Document's `title`), so the panel shows one header.
   * Absent = the host draws it above `component`.
   */
  ownHeader?: boolean;
  /** A human label for one Document (search, chips, breadcrumb); the id when absent. */
  title?: (doc: unknown, ctx: DocumentLabelContext) => string;
  /** Registry rows show `title` instead of the id (a command's `/name` is its identity). */
  listByTitle?: boolean;
  /** A fresh Document with that id, the shape the host pushes into `project.documents[kind]`. */
  create: (input: { id: string; projectId: string }) => unknown;
  /** File → Document, what `projectFromFiles` runs on `<dir>/<id>.yaml` (`src` carries `id`). */
  parse: (src: Record<string, unknown>, ctx: DocumentParseContext) => DocumentParseResult;
  /** Document → canonical file object, `id` included (the host strips it). */
  serialize: (doc: unknown, project: unknown) => Record<string, unknown>;
  /**
   * The text sites of a Document: every `LText` node it holds with its canonical i18n
   * key. Without it, the kind's texts are invisible to the Translations panel and are
   * neither re-keyed nor garbage-collected by the host.
   */
  ltextSites?: (doc: unknown) => Iterable<LTextSiteContribution>;
  /**
   * The action chains of a Document (its triggers): the board derives its edges from
   * their `document_ref` arguments, and the host addresses their texts under `prefix`.
   */
  chainSlots?: (doc: unknown) => Iterable<ChainSlotContribution>;
  /**
   * Board overrides, all optional. `size` is the node's box; `render` a NON-interactive
   * preview drawn inside the node (react-konva), under the host's label. Editing happens
   * in the Properties panel.
   */
  board?: {
    size?: { width: number; height: number };
    /** The node's second line (`"dialog · 2btn"` for a dialog); the kind name when absent. */
    summary?: (doc: unknown, ctx: DocumentLabelContext) => string;
    render?: ComponentType<DocumentPreviewProps>;
    /**
     * The Document's parts the board lists under its header, one row each, like a menu's
     * elements (SDK 1.2): a click selects the part, and the kind's `component` receives it
     * as `item`. The node grows with the rows; `size.width` still sets its width.
     */
    items?: (doc: unknown, ctx: DocumentLabelContext) => BoardItem[];
    /**
     * The node's colour (`"#f59e0b"`, or a host token `"var(--kind-trigger)"` that follows the
     * theme): its border, header band and title (SDK 1.5). The
     * host's default blue when absent.
     */
    accent?: string;
  };
}

/** The container of a kind's Documents (`DocumentKindContribution.collection`). */
export interface DocumentCollection {
  /** The container's name per interface language (`{ en: "Catalog", fr: "Catalogue" }`). */
  labels: Record<string, string>;
  /**
   * A Config screen of the module (`api.screens.declare` id, `"boutique:settings"`) shown at
   * the top of the collection's page: the settings that apply to the whole collection.
   */
  screen?: string;
}

/** One row of a Document's board node (`board.items`). */
export interface BoardItem {
  /** Stable within the Document: what `DocumentEditorProps.item` carries once selected. */
  id: string;
  label: string;
  /** A short second text, right-aligned and dimmed (`"3 objectives"`). */
  detail?: string;
  /**
   * A line under the label, dimmed (SDK 1.7): what the part asks (`"Break 64 stone"`). A
   * collection's page shows it on the Document's card.
   */
  caption?: string;
  /**
   * A short mark before the label, in a disc (SDK 1.5): the part's rank when the parts run
   * in order (`"1"`, `"2"`…). When every row has one, the discs are linked by a line.
   */
  marker?: string;
  /** What a tooltip shows while the pointer is over the row (SDK 1.5). */
  hover?: BoardItemHover;
  /**
   * An item drawn before the label (SDK 1.8), as the Document holds it: a material
   * (`DIAMOND`), a captured item (`item:<id>`) or an item map (`{extends, title, lore…}`). The
   * host resolves it like a menu button's item and draws its texture.
   */
  icon?: unknown;
}

/** A `BoardItem`'s tooltip; every text is MiniMessage. */
export interface BoardItemHover {
  title?: string;
  /** A paragraph under the title; `\n` breaks lines. */
  text?: string;
  /** A list under the text, one entry per line (a quest's objectives). */
  lines?: string[];
}

export interface DocumentEditorProps {
  projectId: string;
  documentId: string;
  document: unknown;
  /**
   * The part of the Document selected on the board or by `selectDocumentItem` (a
   * `board.items` id), undefined when the Document itself is (SDK 1.2).
   */
  item?: string;
}

export interface DocumentPreviewProps {
  projectId: string;
  document: unknown;
  size: { width: number; height: number };
}

export interface DocumentLabelContext {
  project: unknown;
  lang: string;
}

export interface DocumentParseContext {
  projectId: string;
  lang: string;
  translations?: Record<string, Record<string, string>>;
}

export interface DocumentParseResult {
  doc: unknown;
  i18nKeys: Record<string, Record<string, string>>;
  /** Constructs of the file without a domain equivalent, dropped on import. */
  unsupported: string[];
}

/** One `LText` node of a Document and its canonical key (the host's `LTextSite`). */
export interface LTextSiteContribution {
  lText: { key: string };
  key: string;
  /** Where the node lives in the Document, for the Translations panel. */
  path: string;
  /** What the site is ("quest.title"); the host's own kinds are listed in `domain/i18nSites.ts`. */
  kind: string;
}

/** One action chain of a Document (the host's `Step[]`). */
export interface ChainSlotContribution {
  /** The slot's name in the Document ("on_start", "right_click"). */
  name: string;
  steps: unknown[];
  /** The i18n address prefix of the chain's texts ("quests.<id>.on_start"). */
  prefix: string;
  /** What the board's edge shows for this trigger; `name` when absent. */
  label?: string;
}

export interface ModuleSidebarEntry {
  icon: ComponentType<{ className?: string }> | (() => ReactNode);
  label: string;
  to: string;
}

/**
 * What a module's own Config screen view receives (`FrontendModule.screens`, ADR
 * `module-config-screens`). The host reads the screen's file from the server, holds the
 * working copy, writes it on Save and keeps its Versions; the view only renders and edits.
 */
export interface ConfigScreenProps {
  /** The project the screen edits (a module's configuration root), for host fields that read it. */
  projectId: string;
  /** `config`: one object (`value`); `table`: rows (`value` is the row array). */
  shape: "config" | "table";
  /** The screen's data as the editor holds it, typed by the declared model when there is one. */
  value: unknown;
  /**
   * Replaces the value at `path`: keys from the root for a config, the row index then the
   * keys for a table. Never empty. Unsaved until the admin saves.
   */
  set: (path: (string | number)[], value: unknown) => void;
  /** Table only: appends a row with the model's defaults. */
  addRow: () => void;
  /** Table only: removes the row at `index`. */
  removeRow: (index: number) => void;
  /** A dated copy is shown while the server answers: nothing may be edited. */
  readOnly: boolean;
}

/** What the host passes to `FrontendModule.localPreviewRows` beside the project (SDK 1.12). */
export interface LocalPreviewContext {
  /** The server's last rows for the ref; absent while unknown (server offline, not fetched yet). */
  serverRows?: Record<string, unknown>[];
  /** The fetcher params the menu declares on the source input; absent when none. */
  params?: Record<string, string>;
}

export interface ModuleRouteDecl {
  path: string;
  component: ComponentType;
}

export interface FrontendModule {
  id: string;
  displayName: string;
  schemaVersion: string;
  /**
   * The SDK version the module was built against (`SDK_VERSION` at its build). Checked
   * when the module comes as a bundle at runtime; a module compiled into the editor
   * shares its SDK and may leave it out.
   */
  sdk?: string;
  sidebar: ModuleSidebarEntry;
  routes: ModuleRouteDecl[];
  wsMessageTypes?: string[];
  onMount?: () => void;
  onUnmount?: () => void;
  /**
   * Files this module contributes to the project bundle on export, keyed by
   * project-relative path. Keys MUST live under "<moduleId>/" (enforced by
   * collectModuleExportFiles); out-of-namespace keys are dropped.
   */
  exportFiles?: (project: unknown) => Record<string, string>;
  /**
   * Authoring-time rows for one of this module's data sources, computed from
   * the module's own project state (moduleData) — so canvas/library tiles
   * update LIVE while editing the module's form, before any deploy. Return
   * null when the ref isn't this module's or the project holds no data for it
   * (the host then falls back to the live server snapshot). Must mirror the
   * plugin fetcher's row shape. The host resolves localized values in the
   * project's dataSources before calling this hook, using the preview language.
   *
   * SDK 1.12: `ctx.serverRows` carries the server's last rows for the ref when the
   * host has them (fetched with the preview player). A source the plugin declares
   * `mixed` (definitions in the project's files, per-player state on the server)
   * starts from these rows and replaces their definition fields with the draft's,
   * matched by the declared key field; a row the draft adds gets the default state,
   * a row the draft removes disappears. A `content` source ignores them.
   * `ctx.params` are the fetcher params the menu declares on the source input
   * (`group: daily`): apply them as the plugin's fetcher does.
   */
  localPreviewRows?: (
    project: unknown,
    ref: string,
    ctx?: LocalPreviewContext,
  ) => Record<string, unknown>[] | null;
  /** Source ref → declared row model, available independently of server presence. */
  dataSourceModels?: Record<string, string>;
  /** Idempotent, in-memory upgrade after declared models are attached. */
  migrateProject?: (project: unknown) => void;
  /** The Document kinds this module contributes (ADR `extensible-document-kinds`, lot 5). */
  documents?: DocumentKindContribution[];
  /**
   * Views of the module's Config screens, by the `component` key the plugin declares with
   * the screen. A screen whose key is missing here gets the generated form.
   */
  screens?: Record<string, ComponentType<ConfigScreenProps>>;
}
