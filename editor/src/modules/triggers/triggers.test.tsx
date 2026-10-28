/**
 * The Trigger kind (ADR `triggers-and-variables`): the core catalog shared with the plugin,
 * the `trigger/v1` codec against its published schema, the chain edited through the
 * generic `document` address, and the page.
 */
import "@/i18n";
import { resetDocumentKinds } from "@/domain/documentKinds";
import { documentsOf } from "@/domain/documents";
import type { OpenProjects, Project, ProjectId } from "@/domain/types";
import { storeChainOps } from "@/features/inspector/chain/chainOps";
import { defaultAction } from "@/features/inspector/chain/defaults";
import { registerEditorModule } from "@/lib/moduleDocumentKinds";
import { triggersEn, triggersFr } from "@/locales/triggers";
import { resetDocumentCodecs } from "@/schema/documentCodecs";
import { useProjectsStore } from "@/state/projectsStore";
import { useServerGameEventsStore } from "@/state/serverGameEventsStore";
import { render, screen } from "@testing-library/react";
import Ajv2020 from "ajv/dist/2020";
import i18next from "i18next";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import menuSchema from "../../../../docs/schema/menu/v1/schema.json";
import deathExample from "../../../../docs/schema/trigger/v1/examples/death-coordinates.json";
import spawnExample from "../../../../docs/schema/trigger/v1/examples/spawn-protection.json";
import welcomeExample from "../../../../docs/schema/trigger/v1/examples/welcome.json";
import triggerSchema from "../../../../docs/schema/trigger/v1/schema.json";
import { clearRegistry } from "../../../packages/editor-sdk/src/contract/registry";
import { groupEvents } from "./EventPicker";
import { TriggerEditor } from "./TriggerEditor";
import {
  CORE_GAME_EVENTS,
  EVENT_GROUPS,
  eventContextEntries,
  findGameEvent,
  mergeGameEvents,
} from "./gameEvents";
import { triggersModule } from "./index";
import { type Trigger, triggerFromFile, triggerToFile } from "./trigger";
import { triggerKind } from "./triggerKind";

const PID = "p1" as ProjectId;

function project(triggers: Trigger[] = []): Project {
  return {
    id: PID,
    name: "p",
    source: "user_created",
    createdAt: "",
    updatedAt: "",
    documents: { menu: [], command: [], dialog: [], trigger: triggers as never[] },
    assets: [],
    dataSources: [],
    importedConnectors: [],
    i18nKeys: {},
    defaultLang: "en",
    canvasLayout: {},
  } as Project;
}

const parse = (src: Record<string, unknown>) =>
  triggerFromFile({ id: "t_x", ...src }, { projectId: PID, lang: "en" });

describe("the Game event catalog", () => {
  it("names every core event in French and English, in a known domain", () => {
    expect(CORE_GAME_EVENTS.length).toBeGreaterThanOrEqual(29);
    const fr = triggersFr.events as Record<string, { title: string; short: string }>;
    const en = triggersEn.events as Record<string, { title: string; short: string }>;
    for (const e of CORE_GAME_EVENTS) {
      expect(fr[e.name]?.title, e.name).toBeTruthy();
      expect(en[e.name]?.short, e.name).toBeTruthy();
      expect(EVENT_GROUPS as readonly string[]).toContain(e.group);
      for (const effect of e.effects) {
        expect(triggersFr.effects, `${e.name}.${effect.name}`).toHaveProperty(effect.name);
      }
    }
  });

  it("lets the server's copy win and adds a module's events", () => {
    const join = findGameEvent(CORE_GAME_EVENTS, "player_join")!;
    const merged = mergeGameEvents([
      { ...join, frequency: "normal" },
      {
        name: "quests:completed",
        group: "quests",
        frequency: "rare",
        context: [],
        cancellable: false,
        effects: [],
        moduleId: "quests",
      },
    ]);
    expect(findGameEvent(merged, "player_join")?.frequency).toBe("normal");
    expect(findGameEvent(merged, "quests:completed")?.moduleId).toBe("quests");
    expect(merged).toHaveLength(CORE_GAME_EVENTS.length + 1);
    // The core's domains first, in their order; a module's after.
    const groups = groupEvents(merged).map(([g]) => g);
    expect(groups.at(-1)).toBe("quests");
    expect(groups.slice(0, 2)).toEqual(["connection", "life"]);
  });

  it("offers the event's values, leaves included, and cancelled if it can be cancelled", () => {
    const death = eventContextEntries(findGameEvent(CORE_GAME_EVENTS, "player_death")!);
    const paths = death.map((e) => e.path);
    expect(paths).toContain("event.location");
    expect(paths).toContain("event.location.x");
    expect(paths).not.toContain("event.cancelled");
    const brk = eventContextEntries(findGameEvent(CORE_GAME_EVENTS, "block_break")!);
    expect(brk.map((e) => e.path)).toContain("event.cancelled");
    expect(brk.find((e) => e.path === "event.cancelled")?.type).toBe("boolean");
  });
});

describe("the trigger/v1 format", () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addSchema(menuSchema);
  const validate = ajv.compile(triggerSchema);

  it.each([
    ["death-coordinates", deathExample],
    ["spawn-protection", spawnExample],
    ["welcome", welcomeExample],
  ])("reads example %s back and rewrites it identically, valid", (_, example) => {
    const { doc, i18nKeys, unsupported } = parse(example as Record<string, unknown>);
    expect(unsupported).toEqual([]);
    const p = project([doc]);
    p.i18nKeys = i18nKeys as never;
    const { id, ...written } = triggerToFile(doc, p);
    expect(id).toBe("t_x");
    expect(written).toEqual(example);
    expect(validate(written), JSON.stringify(validate.errors)).toBe(true);
  });

  it("keeps the delay, the disabled state and unknown keys", () => {
    const { doc } = parse({
      schema: "trigger/v1",
      on: "player_join",
      cooldown_seconds: "30",
      enabled: false,
      notes: "garder",
      do: [],
    });
    expect(doc.cooldownSeconds).toBe(30);
    expect(doc.enabled).toBe(false);
    expect(triggerToFile(doc, project([doc]))).toMatchObject({
      cooldown_seconds: 30,
      enabled: false,
      notes: "garder",
    });
  });

  it("accepts a single `if` and ignores a zero delay", () => {
    const { doc } = parse({ on: "player_join", if: { world_is: "lobby" }, cooldown_seconds: 0 });
    expect(doc.conditions).toHaveLength(1);
    expect(doc.cooldownSeconds).toBeUndefined();
  });
});

describe("a trigger in the project", () => {
  beforeEach(() => {
    registerEditorModule(triggersModule);
    const openProjects: OpenProjects = { projects: [project()], projectOrder: [PID] };
    useProjectsStore.setState({ openProjects });
  });
  afterEach(() => {
    clearRegistry();
    resetDocumentKinds();
    resetDocumentCodecs();
    useServerGameEventsStore.setState({ events: [], status: "idle" } as never);
  });
  const current = () => useProjectsStore.getState().openProjects.projects[0]!;
  const trigger = (id: string) =>
    documentsOf(current(), "trigger").find((d) => d.id === id) as Trigger | undefined;

  it("is created with no event, enabled, and files its texts under triggers.<id>.do", () => {
    useProjectsStore.getState().createDocument({ projectId: PID, kind: "trigger", id: "t_a" });
    expect(trigger("t_a")).toMatchObject({ on: "", enabled: true, steps: [] });

    const ops = storeChainOps(
      useProjectsStore.getState,
      PID,
      {
        kind: "document",
        docKind: "trigger",
        docId: "t_a",
        slot: "do",
      },
      "en",
    );
    ops.add([], 0, { kind: "action", action: defaultAction("send_message") });
    ops.add([], 1, { kind: "action", action: { name: "set_event", value: { keep_level: true } } });
    const steps = trigger("t_a")!.steps;
    expect(steps).toHaveLength(2);
    const keys = Object.keys(current().i18nKeys);
    expect(keys.some((k) => k.startsWith("triggers.t_a.do"))).toBe(true);

    ops.remove({ frames: [], index: 0 });
    expect(trigger("t_a")!.steps).toHaveLength(1);
    expect(Object.keys(current().i18nKeys).some((k) => k.startsWith("triggers.t_a.do"))).toBe(
      false,
    );
    expect(triggerToFile(trigger("t_a")!, current()).do).toEqual([
      { set_event: { keep_level: true } },
    ]);
  });

  it("translates set_event texts like any text shown to the player", () => {
    useProjectsStore.getState().createDocument({ projectId: PID, kind: "trigger", id: "t_w" });
    const ops = storeChainOps(
      useProjectsStore.getState,
      PID,
      { kind: "document", docKind: "trigger", docId: "t_w", slot: "do" },
      "en",
    );
    ops.add([], 0, {
      kind: "action",
      action: { name: "set_event", value: { join_message: { key: "" }, keep_level: true } },
    });
    const value = (trigger("t_w")!.steps[0] as { action: { value: Record<string, unknown> } })
      .action.value;
    const key = (value.join_message as { key: string }).key;
    expect(key).toBe("triggers.t_w.do.set_event.join_message");
    useProjectsStore
      .getState()
      .setI18nValue({ projectId: PID, lt: { key } as never, lang: "en", value: "Hi {player}" });
    useProjectsStore
      .getState()
      .setI18nValue({ projectId: PID, lt: { key } as never, lang: "fr", value: "Salut {player}" });
    expect(triggerToFile(trigger("t_w")!, current()).do).toEqual([
      {
        set_event: { join_message: { en: "Hi {player}", fr: "Salut {player}" }, keep_level: true },
      },
    ]);
  });

  it("summarises its event and steps on the board", () => {
    const { doc } = parse(deathExample as Record<string, unknown>);
    expect(triggerKind.board?.summary?.(doc, { project: project(), lang: "fr" })).toBe(
      i18next.t("triggers.summary", {
        event: i18next.t("triggers.events.player_death.short"),
        count: 2,
      }),
    );
  });
});

describe("a trigger's page", () => {
  beforeAll(async () => {
    await i18next.changeLanguage("fr");
  });
  beforeEach(() => {
    registerEditorModule(triggersModule);
  });
  afterEach(() => {
    clearRegistry();
    resetDocumentKinds();
    resetDocumentCodecs();
  });

  it("states the event as a sentence and shows its values", () => {
    const { doc } = parse(deathExample as Record<string, unknown>);
    useProjectsStore.setState({
      openProjects: { projects: [project([doc])], projectOrder: [PID] },
    });
    render(<TriggerEditor projectId={PID} trigger={doc} />);
    expect(screen.getByRole("heading", { name: "Quand un joueur meurt" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "{event.location.x}" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the event picker on creation", () => {
    const { doc } = parse({ on: "" });
    useProjectsStore.setState({
      openProjects: { projects: [project([doc])], projectOrder: [PID] },
    });
    render(<TriggerEditor projectId={PID} trigger={doc} />);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Quand un joueur casse un bloc")).toBeTruthy();
  });

  it("warns when the active server does not declare the event", () => {
    const { doc } = parse({ on: "quests:completed" });
    useServerGameEventsStore.setState({ events: [], status: "ready" } as never);
    useProjectsStore.setState({
      openProjects: { projects: [project([doc])], projectOrder: [PID] },
    });
    render(<TriggerEditor projectId={PID} trigger={doc} />);
    expect(screen.getByText(/ne déclare pas « quests:completed »/)).toBeTruthy();
    useServerGameEventsStore.setState({ events: [], status: "idle" } as never);
  });
});
