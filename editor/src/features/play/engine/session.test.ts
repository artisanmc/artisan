import type { Command, Menu, Project, ProjectId, Step } from "@/domain/types";
import type { Trigger } from "@/modules/triggers/trigger";
import { afterEach, describe, expect, it, vi } from "vitest";
import { matchCommand } from "./commands";
import { caseMatches, conditionKey, evalCondition } from "./conditions";
import { clickSteps, playMenuSlots } from "./menuSlots";
import { PlaySession } from "./session";
import { DEFAULT_TEST_PLAYER, type TestPlayer, hasPermission } from "./testPlayer";

const say = (key: string): Step => ({
  kind: "action",
  action: { name: "send_message", value: { key } },
});
const act = (name: string, value: unknown = null): Step => ({
  kind: "action",
  action: { name, value },
});

function command(over: Partial<Command>): Command {
  return { id: over.name, projectId: "p", arguments: [], steps: [], ...over } as Command;
}

const shop: Menu = {
  id: "shop",
  projectId: "p",
  title: [],
  rows: 3,
  permission: "shop.use",
  layers: [
    {
      id: "l",
      name: "l",
      elements: [
        {
          id: "sword",
          positions: "13",
          display: {
            material: "DIAMOND_SWORD",
            title: { key: "t.sword" },
            click: { left: { steps: [act("give_item", { material: "DIAMOND_SWORD", count: 1 })] } },
          },
          states: [
            {
              if: [{ type: "has_permission", perm: "shop.vip" }],
              material: "NETHERITE_SWORD",
              click: { left: { steps: [act("open_menu", "vip")] } },
            },
          ],
        },
      ],
    },
  ],
} as unknown as Menu;

const vip = { ...shop, id: "vip", permission: undefined, layers: [] } as unknown as Menu;

function project(): Project {
  return {
    id: "p",
    name: "p",
    defaultLang: "en",
    i18nKeys: {
      "t.hello": { en: "<green>Hello {player}!", fr: "<green>Salut {player} !" },
      "t.sword": { en: "<aqua>Sword" },
      "t.money": { en: "You have %vault_eco_balance% coins" },
      "t.rich": { en: "rich" },
      "t.poor": { en: "poor" },
    },
    documents: {
      menu: [shop, vip],
      command: [
        command({ name: "hello", aliases: ["hi"], steps: [say("t.hello")] }),
        command({ name: "shop", permission: "shop.use", steps: [act("open_menu", "shop")] }),
        command({
          name: "pay",
          arguments: [
            { name: "target", type: "player", required: true },
            { name: "amount", type: "integer", required: true },
          ],
          steps: [act("give_money", { amount: "{amount}" })],
          subcommands: [command({ name: "all", steps: [act("broadcast", "everyone")] })],
        }),
        command({ name: "off", enabled: false, steps: [say("t.hello")] }),
      ],
      dialog: [],
      trigger: [
        {
          id: "welcome",
          projectId: "p",
          on: "player_join",
          enabled: true,
          conditions: [{ type: "has_money", amount: 500 }],
          steps: [act("show_title", { title: "Welcome", stay: 20 })],
        } as Trigger as never,
      ],
    },
    assets: [],
    dataSources: [],
    canvasLayout: {},
  } as unknown as Project;
}

/** A second Project of the server, on disk as `boutique`: its menu opens from `p`. */
const other = {
  id: "q",
  diskId: "boutique",
  name: "boutique",
  defaultLang: "en",
  i18nKeys: {},
  documents: {
    menu: [{ ...vip, id: "main", projectId: "q" }],
    command: [
      command({ name: "store", projectId: "q" as ProjectId, steps: [act("open_menu", "main")] }),
    ],
    dialog: [],
    trigger: [],
  },
  assets: [],
  dataSources: [],
  canvasLayout: {},
} as unknown as Project;

function session(player: Partial<TestPlayer> = {}, lang = "en") {
  const p = project();
  const current = { ...DEFAULT_TEST_PLAYER, ...player };
  return new PlaySession({
    projects: () => [p, other],
    lang: () => lang,
    player: () => current,
    t: (key, values) => (values ? `${key} ${JSON.stringify(values)}` : key),
    menuScope: () => ({}),
  });
}

afterEach(() => vi.useRealTimers());

describe("matchCommand", () => {
  const commands = project().documents.command as Command[];
  it("matches a name or an alias, case-insensitively", () => {
    expect(matchCommand("/HI", commands, "Steve")).toMatchObject({
      kind: "match",
      path: ["hello"],
    });
  });
  it("binds arguments and descends into sub-commands", () => {
    expect(matchCommand("/pay Alex 30", commands, "Steve")).toMatchObject({
      kind: "match",
      args: { target: "Alex", amount: "30" },
    });
    expect(matchCommand("/pay all", commands, "Steve")).toMatchObject({ path: ["pay", "all"] });
  });
  it("says which required argument is missing", () => {
    expect(matchCommand("/pay Alex", commands, "Steve")).toMatchObject({
      kind: "missing",
      arg: "amount",
    });
  });
  it("does not know a disabled or foreign command", () => {
    expect(matchCommand("/off", commands, "Steve").kind).toBe("unknown");
    expect(matchCommand("/gamemode creative", commands, "Steve").kind).toBe("unknown");
  });
});

describe("conditions", () => {
  const env = (player: Partial<TestPlayer> = {}) => ({
    player: { ...DEFAULT_TEST_PLAYER, ...player },
    render: (s: string) => s.replace("%x%", "7"),
    evaluate: (expr: string) => expr === "true",
  });
  it("reads permissions, wildcards and operators", () => {
    const p = { ...DEFAULT_TEST_PLAYER, permissions: ["shop.*"] };
    expect(hasPermission(p, "shop.vip")).toBe(true);
    expect(hasPermission(p, "guild.create")).toBe(false);
    expect(hasPermission({ ...p, op: true }, "guild.create")).toBe(true);
  });
  it("computes what the player says and forces the rest, true by default", () => {
    expect(evalCondition({ type: "has_money", amount: 2000 }, env())).toBe(false);
    expect(
      evalCondition({ type: "placeholder_equals", placeholder: "%x%", value: "7" }, env()),
    ).toBe(true);
    const item = { type: "has_item", material: "DIAMOND", count: 1 } as const;
    expect(evalCondition(item, env())).toBe(true);
    expect(evalCondition(item, env({ forced: { [conditionKey(item)]: false } }))).toBe(false);
  });
  it("joins left to right without precedence", () => {
    const yes = { type: "expression", expr: "true" } as const;
    const no = { type: "expression", expr: "false" } as const;
    // (no and no) or yes = true; no and (no or yes) would be false.
    expect(caseMatches([no, no, yes], ["and", "or"], env())).toBe(true);
    expect(caseMatches([yes, no, yes], ["or", "and"], env())).toBe(true);
    expect(caseMatches([yes, yes, no], ["or", "and"], env())).toBe(false);
  });
});

describe("PlaySession", () => {
  it("runs a typed command: its messages reach the chat, rendered for the player", () => {
    const s = session({ name: "Alex" }, "fr");
    s.sendChat("/hello");
    expect(s.getState().chat).toEqual(["<green>Salut Alex !"]);
    expect(s.getState().log.map((e) => e.kind)).toEqual(["info", "visual"]);
  });

  it("notes a foreign command as not simulated, without running anything", () => {
    const s = session();
    s.sendChat("/gamemode creative");
    expect(s.getState().chat).toEqual([]);
    expect(s.getState().log).toMatchObject([
      { kind: "warn", text: expect.stringContaining("commandNotSimulated") },
    ]);
  });

  it("echoes plain chat with the player's name, tags escaped", () => {
    const s = session();
    s.sendChat("<red>hi");
    expect(s.getState().chat).toEqual(["\\<Steve> \\<red>hi"]);
  });

  it("refuses a command the player lacks the permission of", () => {
    const s = session();
    s.sendChat("/shop");
    expect(s.getState().menu).toBeNull();
    expect(s.getState().chat).toEqual(["<red>play.chat.noPermission"]);
  });

  it("notes world actions instead of running them, arguments rendered", () => {
    const s = session();
    s.sendChat("/pay Alex 30");
    expect(s.getState().log.at(-1)).toMatchObject({
      kind: "logged",
      text: 'play.log.give_money {"amount":"30","currency":""}',
      source: "/pay",
    });
  });

  it("opens menus, shows each slot's state for the player and runs its click", () => {
    const s = session({ permissions: ["shop.use"] });
    s.sendChat("/shop");
    const open = s.getState().menu!;
    expect(open.menuId).toBe("shop");
    const p = project();
    const slots = (player: Partial<TestPlayer>) =>
      playMenuSlots({
        menu: shop,
        project: p,
        scope: {},
        pages: {},
        lang: "en",
        env: () => ({
          player: { ...DEFAULT_TEST_PLAYER, ...player },
          render: (t) => t,
          evaluate: () => false,
        }),
        render: (t) => t,
      });
    const plain = slots({ permissions: ["shop.use"] }).get(13)!;
    expect(plain).toMatchObject({ material: "DIAMOND_SWORD", title: "<aqua>Sword" });
    s.clickSlot(plain.element, clickSteps(plain.appearance, "left")!, 13, "left", plain.scope);
    expect(s.getState().log.at(-1)).toMatchObject({ kind: "logged" });
    expect(s.getState().log.at(-1)!.source).toContain('"slot":13');

    const vipSlot = slots({ permissions: ["shop.use", "shop.vip"] }).get(13)!;
    expect(vipSlot.material).toBe("NETHERITE_SWORD");
    expect(clickSteps(vipSlot.appearance, "right")).toBeNull();
    s.clickSlot(
      vipSlot.element,
      clickSteps(vipSlot.appearance, "left")!,
      13,
      "left",
      vipSlot.scope,
    );
    expect(s.getState().menu?.menuId).toBe("vip");
    s.runSteps([act("open_previous_menu")], { label: "x", scope: {}, project: project() });
    expect(s.getState().menu?.menuId).toBe("shop");
    s.closeMenu();
    expect(s.getState().menu).toBeNull();
  });

  it("fires a trigger when its conditions hold, and the title goes once its time is up", () => {
    vi.useFakeTimers();
    const s = session({ money: 1000 });
    const trigger = s.triggers()[0]!;
    s.runTrigger(trigger);
    expect(s.getState().title).toEqual({ title: "Welcome", subtitle: undefined });
    vi.advanceTimersByTime((10 + 20 + 20) * 50);
    expect(s.getState().title).toBeNull();

    const poor = session({ money: 10 });
    poor.runTrigger(trigger);
    expect(poor.getState().title).toBeNull();
    expect(poor.getState().log.at(-1)!.text).toBe("play.log.conditionsNotMet");
  });

  it("branches on the test player and remembers the conditions it had to force", () => {
    const s = session({ money: 50 });
    s.runSteps(
      [
        {
          kind: "if",
          cases: [{ conditions: [{ type: "has_money", amount: 100 }], steps: [say("t.rich")] }],
          else: [say("t.poor")],
        },
        {
          kind: "if",
          cases: [
            {
              conditions: [{ type: "player_in_region", region: "spawn" }],
              steps: [say("t.money")],
            },
          ],
        },
      ],
      { label: "x", scope: {}, project: project() },
    );
    expect(s.getState().chat).toEqual(["poor", "You have 50 coins"]);
    expect(Object.keys(s.getState().forced)).toEqual([
      conditionKey({ type: "player_in_region", region: "spawn" }),
    ]);
  });

  it("notes an action nobody declared visual, with its value", () => {
    const s = session();
    s.runSteps([act("quests:start", "forge")], { label: "x", scope: {}, project: project() });
    expect(s.getState().log).toMatchObject([
      { kind: "logged", text: "quests:start · forge", detail: expect.stringContaining("quests") },
    ]);
  });

  it("names a module action's arguments from its declaration", () => {
    const p = project();
    const s = new PlaySession({
      projects: () => [p, other],
      lang: () => "en",
      player: () => DEFAULT_TEST_PLAYER,
      t: (key, values) => (values ? `${key} ${JSON.stringify(values)}` : key),
      menuScope: () => ({}),
      declaredActions: () => [
        { name: "attribution:choose", args: [], primary: "source", moduleId: "attribution" },
      ],
    });
    s.runSteps([act("attribution:choose", "youtube")], { label: "x", scope: {}, project: p });
    expect(s.getState().log.at(-1)).toMatchObject({
      text: "attribution:choose · source = youtube",
      detail: 'play.log.moduleAction {"module":"attribution"}',
    });
  });

  it("runs every Project of the server: commands, and menus by their qualified name", () => {
    const s = session();
    s.sendChat("/store");
    expect(s.getState().menu).toMatchObject({ projectId: "q", menuId: "main" });
    s.runSteps([act("open_menu", "boutique:main")], {
      label: "x",
      scope: {},
      project: project(),
    });
    expect(s.getState().menu).toMatchObject({ projectId: "q", menuId: "main" });
    expect(s.getState().log.at(-1)!.text).toContain("boutique:main");
    s.runSteps([act("open_menu", "main")], { label: "x", scope: {}, project: project() });
    expect(s.getState().log.at(-1)).toMatchObject({ kind: "warn" });
  });

  it("stops a command that runs itself", () => {
    const s = session();
    const p = project();
    (p.documents.command as Command[]).push(
      command({ name: "loop", steps: [act("run_command", "loop")] }),
    );
    const looping = new PlaySession({
      projects: () => [p],
      lang: () => "en",
      player: () => DEFAULT_TEST_PLAYER,
      t: (k) => k,
      menuScope: () => ({}),
    });
    looping.sendChat("/loop");
    expect(looping.getState().log.at(-1)!.text).toBe("play.log.tooDeep");
    expect(s.getState().log).toEqual([]);
  });
});
