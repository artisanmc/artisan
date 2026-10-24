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

describe("le catalogue des événements", () => {
  it("nomme chaque événement du cœur en français et en anglais, dans un domaine connu", () => {
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

  it("laisse la copie du serveur l'emporter et ajoute les événements d'un module", () => {
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

  it("offre les valeurs de l'événement, feuilles comprises, et cancelled s'il est annulable", () => {
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

describe("le format trigger/v1", () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addSchema(menuSchema);
  const validate = ajv.compile(triggerSchema);

  it.each([
    ["death-coordinates", deathExample],
    ["spawn-protection", spawnExample],
    ["welcome", welcomeExample],
  ])("relit l'exemple %s et le réécrit à l'identique, valide", (_, example) => {
    const { doc, i18nKeys, unsupported } = parse(example as Record<string, unknown>);
    expect(unsupported).toEqual([]);
    const p = project([doc]);
    p.i18nKeys = i18nKeys as never;
    const { id, ...written } = triggerToFile(doc, p);
    expect(id).toBe("t_x");
    expect(written).toEqual(example);
    expect(validate(written), JSON.stringify(validate.errors)).toBe(true);
  });

  it("garde le délai, l'état désactivé et les clés inconnues", () => {
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

  it("accepte un `if` unique et ignore un délai nul", () => {
    const { doc } = parse({ on: "player_join", if: { world_is: "lobby" }, cooldown_seconds: 0 });
    expect(doc.conditions).toHaveLength(1);
    expect(doc.cooldownSeconds).toBeUndefined();
  });
});

describe("un trigger dans le projet", () => {
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

  it("se crée sans événement, actif, et range ses textes sous triggers.<id>.do", () => {
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

  it("résume son événement et ses étapes sur le tableau", () => {
    const { doc } = parse(deathExample as Record<string, unknown>);
    expect(triggerKind.board?.summary?.(doc, { project: project(), lang: "fr" })).toBe(
      i18next.t("triggers.summary", {
        event: i18next.t("triggers.events.player_death.short"),
        count: 2,
      }),
    );
  });
});

describe("la page d'un trigger", () => {
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

  it("dit l'événement comme une phrase et montre ses valeurs", () => {
    const { doc } = parse(deathExample as Record<string, unknown>);
    useProjectsStore.setState({
      openProjects: { projects: [project([doc])], projectOrder: [PID] },
    });
    render(<TriggerEditor projectId={PID} trigger={doc} />);
    expect(screen.getByRole("heading", { name: "Quand un joueur meurt" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "{event.location.x}" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("ouvre le choix de l'événement à la création", () => {
    const { doc } = parse({ on: "" });
    useProjectsStore.setState({
      openProjects: { projects: [project([doc])], projectOrder: [PID] },
    });
    render(<TriggerEditor projectId={PID} trigger={doc} />);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Quand un joueur casse un bloc")).toBeTruthy();
  });

  it("prévient quand le serveur actif ne déclare pas l'événement", () => {
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
