import { isLTextNode } from "@/domain/actionArgs";
import { normalizeActionArgs } from "@/domain/actionArgs";
import { commandsOf, documentsOf, menusOf } from "@/domain/documents";
import type { Action, Condition, Element, LText, Menu, Project, Step } from "@/domain/types";
import { coreActionOf } from "@/lib/actions/coreActions";
import type { DeclaredAction } from "@/lib/api/declaredActions";
import { AstCache } from "@/lib/expr/cache";
import { evaluate } from "@/lib/expr/evaluator";
import { parse } from "@/lib/expr/parser";
import { Scope } from "@/lib/expr/scope";
import { renderTemplate } from "@/lib/expr/template/renderer";
import { getText } from "@/lib/i18n";
import { lookupPath } from "@/lib/placeholders";
import { parsePositions } from "@/lib/positions";
import type { Trigger } from "@/modules/triggers/trigger";
import { matchCommand } from "./commands";
import { type ConditionEnv, caseMatches } from "./conditions";
import { type TestPlayer, builtinPlaceholders, hasPermission } from "./testPlayer";

/** One line of the journal: what ran, from where, and whether the screen shows it. */
export interface PlayLogEntry {
  id: number;
  /**
   * `visual`: run in the screen; `logged`: noted, not run (give, money, teleport…);
   * `sound`: a sound, noted until sounds play; `info`: a command typed, a trigger fired;
   * `warn`: refused or not simulated.
   */
  kind: "visual" | "logged" | "sound" | "info" | "warn";
  text: string;
  /** What the line cannot say alone (a module action runs on the server, not here). */
  detail?: string;
  source: string;
}

/** The menu on screen: its id, the context it was opened with, and its pages. */
export interface OpenMenu {
  /** The Project the menu belongs to: its unqualified references resolve there. */
  projectId: string;
  menuId: string;
  args: Record<string, unknown>;
  pages: Record<string, number>;
}

export interface PlayState {
  /** Chat lines, oldest first, as MiniMessage. */
  chat: string[];
  title: { title: string; subtitle?: string } | null;
  actionBar: string | null;
  menu: OpenMenu | null;
  /** Menus `open_previous_menu` goes back to, the last one on top. */
  history: OpenMenu[];
  log: PlayLogEntry[];
  /** Conditions that took a forced value, by key, to list them on the test player. */
  forced: Record<string, Condition>;
}

const EMPTY: PlayState = {
  chat: [],
  title: null,
  actionBar: null,
  menu: null,
  history: [],
  log: [],
  forced: {},
};

/** The editor's strings the engine writes (journal lines, chat refusals). */
export type PlayTranslate = (key: string, values?: Record<string, unknown>) => string;

export interface PlaySessionOptions {
  /** Every Project of the server: the game runs them all at once. */
  projects: () => readonly Project[];
  lang: () => string;
  player: () => TestPlayer;
  t: PlayTranslate;
  /** Live rows of server sources by ref, for menus that read them. */
  snapshots?: () => Record<string, unknown[]>;
  /** The actions the server's modules declare: names their arguments in the journal. */
  declaredActions?: () => readonly DeclaredAction[];
  /** A menu's scope as the canvas builds it (inputs, sources, `player`), args given. */
  menuScope: (
    menu: Menu,
    project: Project,
    args: Record<string, unknown>,
  ) => Record<string, unknown>;
}

/** Where a chain runs from, for the journal. */
export interface RunSource {
  label: string;
  scope: Record<string, unknown>;
  /** The Project the chain belongs to: its texts and unqualified references. */
  project: Project;
}

const MAX_DEPTH = 16;
const LOG_LIMIT = 500;
const TICK_MS = 50;

/**
 * The Play mode's engine: runs the server's chains against a test player, without a
 * server. Every Project is live at once, as in game: a command of one opens a menu of
 * another (`<project>:<menu>`). Visual actions change what the screen shows (chat, title, menus); the others
 * are noted in the journal with their source. An action nobody declared as visual is
 * noted, never run. Display state only: nothing here writes the Project.
 */
export class PlaySession {
  private state: PlayState = EMPTY;
  private listeners = new Set<() => void>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private nextId = 1;
  private readonly cache = new AstCache(256);

  constructor(private readonly opts: PlaySessionOptions) {}

  // Store

  getState = (): PlayState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<PlayState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  private log(kind: PlayLogEntry["kind"], text: string, source: string, detail?: string): void {
    const entry: PlayLogEntry = {
      id: this.nextId++,
      kind,
      text,
      source,
      ...(detail ? { detail } : {}),
    };
    this.set({ log: [...this.state.log, entry].slice(-LOG_LIMIT) });
  }

  private chat(line: string): void {
    this.set({ chat: [...this.state.chat, line].slice(-100) });
  }

  /** Back to an empty screen: chat, title, menus and journal cleared, waits cancelled. */
  reset(): void {
    this.cancelWaits();
    this.state = EMPTY;
    for (const l of this.listeners) l();
  }

  clearLog(): void {
    this.set({ log: [] });
  }

  /** Ends what is waiting (a title on screen) now, as if its time had passed. */
  skipWaits(): void {
    this.cancelWaits();
    this.set({ title: null });
  }

  private cancelWaits(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  private later(ms: number, run: () => void): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      run();
    }, ms);
    this.timers.add(timer);
  }

  // Inputs

  /** A line sent from the chat: a command when it starts with `/`, else a chat message. */
  sendChat(line: string): void {
    const text = line.trim();
    if (!text) return;
    if (text.startsWith("/")) {
      this.runCommand(text);
      return;
    }
    const name = this.opts.player().name;
    this.chat(`\\<${escapeTags(name)}> ${escapeTags(text)}`);
  }

  /** Runs a typed command against the Project's commands; an unknown one is noted as not simulated. */
  runCommand(line: string, from?: RunSource, depth = 0): void {
    const player = this.opts.player();
    const typed = line.trim().startsWith("/") ? line.trim() : `/${line.trim()}`;
    const source = from?.label ?? typed;
    const match = matchCommand(typed, this.commands(), player.name);
    if (match.kind === "unknown") {
      this.log("warn", this.opts.t("play.log.commandNotSimulated", { command: typed }), source);
      return;
    }
    if (match.kind === "missing") {
      this.chat(`<red>${escapeTags(this.opts.t("play.chat.missingArgument", { arg: match.arg }))}`);
      this.log("warn", this.opts.t("play.log.missingArgument", { arg: match.arg }), typed);
      return;
    }
    if (match.node.permission && !hasPermission(player, match.node.permission)) {
      this.chat(`<red>${escapeTags(this.opts.t("play.chat.noPermission"))}`);
      this.log(
        "warn",
        this.opts.t("play.log.noPermission", { permission: match.node.permission }),
        typed,
      );
      return;
    }
    const project = this.projectById(match.command.projectId);
    if (!project) return;
    this.log("info", typed, from?.label ?? this.opts.t("play.source.chat"));
    this.runSteps(
      match.node.steps,
      {
        label: `/${match.path.join(" ")}`,
        scope: { ...this.baseScope(), ...(from?.scope ?? {}), ...match.args },
        project,
      },
      depth + 1,
    );
  }

  /** Fires a Trigger as if its event happened: its conditions on the test player, then its chain. */
  runTrigger(trigger: Trigger): void {
    const source = this.opts.t("play.source.trigger", { id: trigger.id });
    const scope = this.baseScope();
    const project = this.projectById(trigger.projectId);
    if (!project) return;
    if (trigger.enabled === false) {
      this.log("warn", this.opts.t("play.log.triggerDisabled"), source);
      return;
    }
    this.log("info", this.opts.t("play.log.triggerFired", { event: trigger.on || "?" }), source);
    if (!caseMatches(trigger.conditions, undefined, this.env(scope, project))) {
      this.log("warn", this.opts.t("play.log.conditionsNotMet"), source);
      return;
    }
    this.runSteps(trigger.steps, { label: source, scope, project });
  }

  /** A click on a slot of the open menu: the chain of that click type, in the slot's scope. */
  clickSlot(
    element: Element,
    steps: Step[],
    position: number,
    click: string,
    scope: Record<string, unknown>,
  ): void {
    const menu = this.state.menu;
    const project = menu && this.projectById(menu.projectId);
    if (!menu || !project) return;
    const label = this.opts.t("play.source.slot", {
      menu: menu.menuId,
      slot: position,
      click: this.opts.t(`play.click.${click}`),
      element: element.id,
    });
    this.runSteps(steps, { label, scope, project });
  }

  /** Opens a menu from the launcher, as an `open_menu` would. */
  openMenuById(projectId: string, menuId: string): void {
    const project = this.projectById(projectId);
    if (!project) return;
    this.runSteps([{ kind: "action", action: { name: "open_menu", value: menuId } }], {
      label: this.opts.t("play.source.launcher"),
      scope: this.baseScope(),
      project,
    });
  }

  /** Esc or E with a menu open: closes it, as the game does. */
  closeMenu(): void {
    if (this.state.menu) this.set({ menu: null, history: [] });
  }

  /** Changes a page of the open menu (the editor's own arrows, outside the menu). */
  setPage(elementId: string, page: number): void {
    const menu = this.state.menu;
    if (!menu) return;
    this.set({ menu: { ...menu, pages: { ...menu.pages, [elementId]: Math.max(0, page) } } });
  }

  // Chains

  /** Runs a chain: actions in order, `if` cases on the test player. */
  runSteps(steps: readonly Step[], from: RunSource, depth = 0): void {
    if (depth > MAX_DEPTH) {
      this.log("warn", this.opts.t("play.log.tooDeep"), from.label);
      return;
    }
    for (const step of steps) {
      if (step.kind === "action") {
        this.runAction(step.action, from, depth);
        continue;
      }
      const env = this.env(from.scope, from.project);
      const arm = step.cases.find((c) => caseMatches(c.conditions, c.joins, env));
      const branch = arm ? arm.steps : step.else;
      if (branch) this.runSteps(branch, from, depth + 1);
    }
  }

  private runAction(action: Action, from: RunSource, depth: number): void {
    const { project } = from;
    const decl = coreActionOf(action.name);
    const args = decl ? normalizeActionArgs(decl, action.value) : {};
    const text = (key: string) => this.text(args[key], from.scope, project);
    const str = (key: string) => this.render(String(args[key] ?? ""), from.scope, project);
    const t = this.opts.t;
    switch (action.name) {
      case "send_message":
      case "broadcast": {
        const line = text("text");
        for (const l of line.split(/\n|<newline>|<br\/?>/i)) this.chat(l);
        this.log("visual", t("play.log.message", { text: plain(line) }), from.label);
        return;
      }
      case "show_title": {
        const title = text("title");
        const subtitle = text("subtitle");
        const ticks = (k: string, d: number) => Number(args[k] ?? d) || 0;
        const total = ticks("fade_in", 10) + ticks("stay", 70) + ticks("fade_out", 20);
        this.set({ title: { title, subtitle: subtitle || undefined } });
        this.later(total * TICK_MS, () => this.set({ title: null }));
        this.log("visual", t("play.log.showTitle", { text: plain(title || subtitle) }), from.label);
        return;
      }
      case "open_menu":
        this.openMenu(project, args, from);
        return;
      case "close_menu":
        this.set({ menu: null, history: [] });
        this.log("visual", t("play.log.closeMenu"), from.label);
        return;
      case "open_previous_menu": {
        const previous = this.state.history.at(-1);
        this.set({ menu: previous ?? null, history: this.state.history.slice(0, -1) });
        this.log("visual", t("play.log.previousMenu"), from.label);
        return;
      }
      case "pagination_next":
      case "pagination_prev":
        this.turnPage(
          String(args.element_id ?? ""),
          action.name === "pagination_next" ? 1 : -1,
          from,
        );
        return;
      case "set_arg":
      case "set_arg_cycle_next":
      case "set_arg_cycle_prev":
        this.setArg(action.name, args, from);
        return;
      case "play_sound":
        this.log("sound", `♪ ${str("sound")}`, from.label);
        return;
      case "run_command": {
        const command = str("command");
        if ((args.as ?? "player") === "player" && this.isServerCommand(command)) {
          this.runCommand(command, from, depth);
          return;
        }
        this.log(
          "logged",
          t("play.log.runCommand", { command, as: args.as ?? "player" }),
          from.label,
        );
        return;
      }
      case "give_item":
      case "take_item":
        this.log(
          "logged",
          t(`play.log.${action.name}`, { material: str("material"), count: str("count") || "1" }),
          from.label,
        );
        return;
      case "give_money":
      case "take_money":
      case "give_xp":
      case "give_level":
        this.log(
          "logged",
          t(`play.log.${action.name}`, { amount: str("amount"), currency: str("currency") }),
          from.label,
        );
        return;
      case "teleport": {
        const location =
          typeof args.location === "string" ? str("location") : locationText(args.location);
        this.log(
          "logged",
          location
            ? t("play.log.teleportTo", { location })
            : t("play.log.teleport", {
                world: str("world") || this.opts.player().world,
                x: str("x"),
                y: str("y"),
                z: str("z"),
              }),
          from.label,
        );
        return;
      }
      case "set_var":
      case "add_var":
      case "clear_var":
        // Variables live on the server (its suite database): the journal says what would change.
        this.log(
          "logged",
          t(`play.log.${action.name}`, {
            var: String(args.var ?? ""),
            value: str("value"),
            amount: String(args.amount ?? 1),
          }),
          from.label,
        );
        return;
      case "chat_button": {
        const line = `${text("text")} ${text("label")}`.trim();
        this.chat(line);
        this.log("visual", t("play.log.chatButton", { text: plain(line) }), from.label);
        if (Array.isArray(args.do) && args.do.length > 0)
          this.log("logged", t("play.log.chatButtonNotPlayed"), from.label);
        return;
      }
      default: {
        // A module's action runs in its plugin: the journal names it and its arguments,
        // and says it is not played here.
        const declared = this.opts.declaredActions?.().find((a) => a.name === action.name);
        const colon = action.name.indexOf(":");
        const module = declared?.moduleId ?? (colon > 0 ? action.name.slice(0, colon) : null);
        const args = this.describeArgs(action.value, declared, from.scope, project);
        this.log(
          "logged",
          args ? `${action.name} · ${args}` : action.name,
          from.label,
          module ? t("play.log.moduleAction", { module }) : undefined,
        );
      }
    }
  }

  private openMenu(project: Project, args: Record<string, unknown>, from: RunSource): void {
    const t = this.opts.t;
    const ref = String(args.menu_id ?? "");
    const at = ref.indexOf(":");
    const owner = at < 0 ? project : this.projectByNamespace(ref.slice(0, at));
    const id = at < 0 ? ref : ref.slice(at + 1);
    const menu = menusOf(owner).find((m) => m.id === id);
    if (!menu || !owner) {
      this.log("warn", t("play.log.menuNotFound", { menu: ref }), from.label);
      return;
    }
    if (menu.permission && !hasPermission(this.opts.player(), menu.permission)) {
      this.log("warn", t("play.log.noPermission", { permission: menu.permission }), from.label);
      return;
    }
    const given: Record<string, unknown> = {};
    const context = args.context;
    if (context && typeof context === "object") {
      for (const [k, v] of Object.entries(context as Record<string, unknown>)) {
        given[k] = typeof v === "string" ? this.contextValue(v, from) : v;
      }
    }
    const current = this.state.menu;
    const inherited = args.clear_context === true || !current ? {} : current.args;
    this.set({
      menu: { projectId: owner.id, menuId: menu.id, args: { ...inherited, ...given }, pages: {} },
      history: current ? [...this.state.history, current] : this.state.history,
    });
    const name = owner === project ? menu.id : `${owner.diskId ?? owner.id}:${menu.id}`;
    this.log("visual", t("play.log.openMenu", { menu: name }), from.label);
  }

  /**
   * A context value as `open_menu` passes it: `{cat}` alone passes the whole value (a row),
   * any other template its text.
   */
  private contextValue(template: string, from: RunSource): unknown {
    const whole = /^\{([^{}]+)\}$/.exec(template.trim());
    if (whole) {
      try {
        const v = evaluate(parse(whole[1]!), this.scope(from.scope));
        if (v !== undefined) return v;
      } catch {
        // Not an expression: rendered as text below.
      }
    }
    return this.render(template, from.scope, from.project);
  }

  private turnPage(elementId: string, delta: number, from: RunSource): void {
    const menu = this.state.menu;
    if (!menu) return;
    const ids = elementId ? [elementId] : this.iteratingElements(menu);
    const pages = { ...menu.pages };
    for (const id of ids) pages[id] = Math.max(0, (pages[id] ?? 0) + delta);
    this.set({ menu: { ...menu, pages } });
    this.log(
      "visual",
      this.opts.t(delta > 0 ? "play.log.nextPage" : "play.log.previousPage"),
      from.label,
    );
  }

  private iteratingElements(open: OpenMenu): string[] {
    return (this.menuOf(open)?.layers ?? []).flatMap((l) =>
      l.elements.filter((e) => e.iterates || e.places).map((e) => e.id as string),
    );
  }

  private setArg(name: string, args: Record<string, unknown>, from: RunSource): void {
    const menu = this.state.menu;
    if (!menu) return;
    const arg = String(args.arg ?? "");
    let value: unknown;
    if (name === "set_arg") {
      value = typeof args.value === "string" ? this.contextValue(args.value, from) : args.value;
    } else {
      const list = Array.isArray(args.list) ? args.list.map(String) : [];
      const at = list.indexOf(String(menu.args[arg] ?? ""));
      const step = name === "set_arg_cycle_next" ? 1 : -1;
      value = list.length ? list[(at + step + list.length) % list.length] : "";
    }
    this.set({ menu: { ...menu, args: { ...menu.args, [arg]: value }, pages: {} } });
    this.log("visual", this.opts.t("play.log.setArg", { arg, value: String(value) }), from.label);
  }

  private isServerCommand(line: string): boolean {
    return matchCommand(line, this.commands(), "").kind !== "unknown";
  }

  // Projects

  /** Every command of the server, each Project's in turn. */
  private commands() {
    return this.opts.projects().flatMap((p) => commandsOf(p));
  }

  projectById(id: string): Project | undefined {
    return this.opts.projects().find((p) => p.id === id);
  }

  /** The Project a qualified reference names (`boutique:main`): by its id on disk. */
  private projectByNamespace(ns: string): Project | undefined {
    return this.opts.projects().find((p) => (p.diskId ?? p.id) === ns || p.id === ns);
  }

  /** The open menu's Document. */
  menuOf(open: OpenMenu): Menu | undefined {
    return menusOf(this.projectById(open.projectId)).find((m) => m.id === open.menuId);
  }

  // Scope and text

  /** What every chain sees: the player, as the runtime binds it. */
  baseScope(): Record<string, unknown> {
    const player = this.opts.player();
    return {
      player: {
        name: player.name,
        world: player.world,
        level: player.level,
        toString: () => player.name,
      },
      sender: player.name,
    };
  }

  /** The open menu's scope: its inputs and sources as the canvas builds them, the test player, its pages. */
  menuScope(menu: Menu, open: OpenMenu): Record<string, unknown> {
    const project = this.projectById(open.projectId);
    if (!project) return {};
    const scope = this.opts.menuScope(menu, project, open.args);
    if (!(menu.contextInputs ?? []).some((i) => i.name === "player")) {
      scope.player = this.baseScope().player;
    }
    return scope;
  }

  private scope(bag: Record<string, unknown>): Scope {
    const placeholders = {
      ...builtinPlaceholders(this.opts.player()),
      ...this.opts.player().placeholders,
    };
    return new Scope(bag, { papi: (name) => placeholders[name] ?? "" });
  }

  /** A template rendered in `scope`: `{expressions}`, `{i18n:…}`, then `%placeholders%` of the test player. */
  render(template: string, scope: Record<string, unknown>, project: Project): string {
    if (!template) return template;
    const lang = this.opts.lang();
    return renderTemplate(template, {
      scope: this.scope(scope),
      cache: this.cache,
      projectId: project.id,
      projectVersion: 0,
      i18nLookup: (key) => {
        const entry = project.i18nKeys[key as LText["key"]];
        return entry ? (entry[lang] ?? entry[project.defaultLang]) : undefined;
      },
    });
  }

  /** An action's text argument (a text node, or a literal) rendered. */
  private text(value: unknown, scope: Record<string, unknown>, project: Project): string {
    if (value == null) return "";
    const raw = isLTextNode(value) ? getText(project, value, this.opts.lang()) : String(value);
    return this.render(raw, scope, project);
  }

  /** An action's value with its argument names: `source = youtube`, `a = 1, b = 2`. */
  private describeArgs(
    value: unknown,
    declared: DeclaredAction | undefined,
    scope: Record<string, unknown>,
    project: Project,
  ): string {
    if (value == null) return "";
    if (typeof value === "object" && !Array.isArray(value) && !isLTextNode(value)) {
      return Object.entries(value as Record<string, unknown>)
        .map(([k, v]) => `${k} = ${this.describeValue(v, scope, project)}`)
        .join(", ");
    }
    const shown = this.describeValue(value, scope, project);
    const name = declared?.primary ?? (declared?.args.length === 1 ? declared.args[0]?.name : null);
    return name ? `${name} = ${shown}` : shown;
  }

  private describeValue(value: unknown, scope: Record<string, unknown>, project: Project): string {
    if (value == null) return "";
    if (isLTextNode(value)) return plain(this.text(value, scope, project));
    if (typeof value === "string") return this.render(value, scope, project);
    if (typeof value !== "object") return String(value);
    return JSON.stringify(value, (_k, v) =>
      isLTextNode(v) ? plain(this.text(v, scope, project)) : v,
    );
  }

  /** The conditions' view of a scope. */
  env(scope: Record<string, unknown>, project: Project): ConditionEnv {
    return {
      player: this.opts.player(),
      render: (template) => this.render(template, scope, project),
      evaluate: (expr) => evaluate(parse(expr), this.scope(scope)),
      pagination: (elementId) => this.pagination(elementId, scope),
      onForced: (key, condition) => {
        if (!(key in this.state.forced))
          this.set({ forced: { ...this.state.forced, [key]: condition } });
      },
    };
  }

  private pagination(
    elementId: string | undefined,
    scope: Record<string, unknown>,
  ): { page: number; totalPages: number } | null {
    const open = this.state.menu;
    const menu = open && this.menuOf(open);
    if (!open || !menu) return null;
    const element = menu.layers
      .flatMap((l) => l.elements)
      .find((e) => (elementId ? e.id === elementId : e.iterates || e.places));
    if (!element) return null;
    const totalPages = totalPagesOf(element, scope);
    return { page: Math.min(open.pages[element.id] ?? 0, totalPages - 1), totalPages };
  }

  /** The server's Triggers, every Project's, for the launcher. */
  triggers(): Trigger[] {
    return this.opts.projects().flatMap((p) => documentsOf(p, "trigger") as unknown as Trigger[]);
  }
}

/** Pages of an iterating or placing element in a scope. */
export function totalPagesOf(element: Element, scope: Record<string, unknown>): number {
  if (element.iterates) {
    const per = Math.max(1, parsePositions(element.positions).length);
    const list = lookupPath(scope, element.iterates.source);
    return Math.max(1, Math.ceil((Array.isArray(list) ? list.length : 0) / per));
  }
  if (element.places) {
    return Math.max(1, ...element.places.placements.map((p) => p.page + 1));
  }
  return 1;
}

/** Text typed by the player is shown as typed: its tags are not MiniMessage. */
const escapeTags = (text: string) => text.replace(/[\\<]/g, "\\$&");

/** MiniMessage without its tags, for a journal line. */
const plain = (mm: string) => mm.replace(/<[^<>]*>/g, "");

/** A location written as an object (`{world, x, y, z}`) as one line; null when it is none. */
function locationText(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const l = value as Record<string, unknown>;
  return [l.world, l.x, l.y, l.z].map((p) => String(p ?? "?")).join(" ");
}
