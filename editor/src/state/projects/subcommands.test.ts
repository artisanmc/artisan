import { commandNodeAt } from "@/domain/commandNodes";
import { commandsOf } from "@/domain/documents";
import { visitCommandLTexts } from "@/domain/i18nSites";
import { projectId } from "@/domain/ids";
import type { I18nKey, Step } from "@/domain/types";
import { mockOpenProjects } from "@/mock/fixtures";
import { commandV1FromDomain } from "@/schema/commandV1FromDomain";
import { commandV1ToDomain } from "@/schema/commandV1ToDomain";
import { useProjectsStore } from "@/state/projectsStore";
import { beforeEach, describe, expect, it } from "vitest";

const PERSONAL = projectId("p_personal");
const store = () => useProjectsStore.getState();
const project = () => store().openProjects.projects.find((p) => p.id === PERSONAL)!;
const command = (id: string) => commandsOf(project()).find((c) => c.id === id)!;
/** A message step as the chain editor adds it: its text slot minted on insert. */
const say = (): Step => ({
  kind: "action",
  action: { name: "send_message", value: { key: "" as I18nKey } },
});

describe("sub-commands in the store", () => {
  beforeEach(() => useProjectsStore.setState({ openProjects: mockOpenProjects() }));

  function auctionHouse() {
    const id = store().createCommand({ projectId: PERSONAL, id: "ah", name: "ah" });
    const sell = store().addSubcommand({ projectId: PERSONAL, commandId: id, name: "sell" })!;
    const admin = store().addSubcommand({ projectId: PERSONAL, commandId: id, name: "admin" })!;
    const reload = store().addSubcommand({
      projectId: PERSONAL,
      commandId: id,
      sub: admin,
      name: "reload",
    })!;
    return { id, sell, admin, reload };
  }

  it("adds sub-commands under the node they are given, at any depth", () => {
    const { id, sell, admin, reload } = auctionHouse();
    expect(sell).toEqual([0]);
    expect(admin).toEqual([1]);
    expect(reload).toEqual([1, 0]);
    expect(commandNodeAt(command(id), reload)?.name).toBe("reload");
    // A fresh name never repeats a sibling's.
    const next = store().addSubcommand({ projectId: PERSONAL, commandId: id })!;
    const again = store().addSubcommand({ projectId: PERSONAL, commandId: id })!;
    expect([next, again].map((p) => commandNodeAt(command(id), p)?.name)).toEqual(["sub", "sub2"]);
  });

  it("edits a sub-command's fields, arguments and steps without touching the root", () => {
    const { id, sell } = auctionHouse();
    const at = { projectId: PERSONAL, commandId: id, sub: sell };
    store().setCommandField({ ...at, field: "permission", value: "ah.sell" });
    store().setCommandAliases({ ...at, aliases: ["s"] });
    store().addCommandArg({ ...at, arg: { name: "price", type: "integer", required: true } });
    store().addCommandStep({ ...at, frames: [], index: 0, step: say(), lang: "fr" });
    const root = command(id);
    const node = commandNodeAt(root, sell)!;
    expect(node.permission).toBe("ah.sell");
    expect(node.aliases).toEqual(["s"]);
    expect(node.arguments.map((a) => a.name)).toEqual(["price"]);
    expect(node.steps).toHaveLength(1);
    expect(root.permission).toBeUndefined();
    expect(root.arguments).toEqual([]);
    expect(root.steps).toEqual([]);
  });

  it("turns a node off and on without deleting it", () => {
    const { id, admin } = auctionHouse();
    store().setCommandEnabled({ projectId: PERSONAL, commandId: id, sub: admin, enabled: false });
    expect(commandNodeAt(command(id), admin)?.enabled).toBe(false);
    store().setCommandEnabled({ projectId: PERSONAL, commandId: id, sub: admin, enabled: true });
    expect(commandNodeAt(command(id), admin)?.enabled).toBeUndefined();
  });

  it("keeps a description per language and drops it once every language is empty", () => {
    const { id, sell } = auctionHouse();
    const at = { projectId: PERSONAL, commandId: id, sub: sell };
    store().setCommandDescription({ ...at, lang: "fr", value: "Vendre" });
    store().setCommandDescription({ ...at, lang: "en", value: "Sell" });
    const key = commandNodeAt(command(id), sell)!.description!.key;
    expect(project().i18nKeys[key]).toEqual({ fr: "Vendre", en: "Sell" });
    store().setCommandDescription({ ...at, lang: "fr", value: "" });
    store().setCommandDescription({ ...at, lang: "en", value: "" });
    expect(commandNodeAt(command(id), sell)!.description).toBeUndefined();
    expect(project().i18nKeys[key]).toBeUndefined();
  });

  it("removes a sub-command with its texts and its children's", () => {
    const { id, admin, reload } = auctionHouse();
    store().setCommandDescription({
      projectId: PERSONAL,
      commandId: id,
      sub: reload,
      lang: "fr",
      value: "Recharger",
    });
    const key = commandNodeAt(command(id), reload)!.description!.key;
    store().removeSubcommand({ projectId: PERSONAL, commandId: id, sub: admin });
    expect(command(id).subcommands?.map((s) => s.name)).toEqual(["sell"]);
    expect(project().i18nKeys[key]).toBeUndefined();
  });

  it("addresses each node's texts under its own prefix", () => {
    const { id, admin, reload } = auctionHouse();
    store().setCommandDescription({ projectId: PERSONAL, commandId: id, lang: "fr", value: "HDV" });
    store().addCommandStep({
      projectId: PERSONAL,
      commandId: id,
      sub: reload,
      frames: [],
      index: 0,
      step: say(),
      lang: "fr",
    });
    expect(admin).toEqual([1]);
    const sites = [...visitCommandLTexts(command(id))].map((s) => [s.key, s.path]);
    expect(sites).toEqual([
      ["commands.ah.description", "commands.ah.description"],
      [
        "commands.ah.subcommands.1.subcommands.0.message",
        "commands.ah.subcommands.1.subcommands.0.message",
      ],
    ]);
  });
});

describe("command/v1 sub-commands codec", () => {
  beforeEach(() => useProjectsStore.setState({ openProjects: mockOpenProjects() }));

  it("reads and writes the tree, a node's description per language and what it does not model", () => {
    const file = {
      schema: "command/v1",
      id: "ah",
      description: { fr: "Hôtel des ventes", en: "Auction house" },
      actions: [],
      subcommands: [
        {
          name: "sell",
          aliases: ["s"],
          permission: "ah.sell",
          description: "Vendre",
          arguments: [{ name: "price", type: "integer", required: true }],
          actions: [{ send_message: "sold" }],
          cooldown: { id: "ah_sell", duration_seconds: 5 },
        },
        {
          name: "admin",
          enabled: false,
          subcommands: [{ name: "reload", actions: [{ send_message: "ok" }] }],
        },
      ],
    };
    const { command: cmd, i18nKeys } = commandV1ToDomain(file, {
      projectId: PERSONAL,
      lang: "fr",
    });
    expect(cmd.subcommands?.map((s) => s.name)).toEqual(["sell", "admin"]);
    expect(cmd.subcommands?.[0]?.wire).toEqual({
      cooldown: { id: "ah_sell", duration_seconds: 5 },
    });
    expect(cmd.subcommands?.[1]?.enabled).toBe(false);
    expect(i18nKeys[cmd.description!.key]).toEqual({ fr: "Hôtel des ventes", en: "Auction house" });

    const p = { ...project(), defaultLang: "fr", i18nKeys: { ...project().i18nKeys, ...i18nKeys } };
    const out = commandV1FromDomain(cmd, p);
    expect(out.description).toEqual({ fr: "Hôtel des ventes", en: "Auction house" });
    expect(out.subcommands).toEqual([
      {
        name: "sell",
        actions: [{ send_message: "sold" }],
        aliases: ["s"],
        permission: "ah.sell",
        description: "Vendre",
        arguments: [{ name: "price", type: "integer", required: true }],
        cooldown: { id: "ah_sell", duration_seconds: 5 },
      },
      {
        name: "admin",
        enabled: false,
        subcommands: [{ name: "reload", actions: [{ send_message: "ok" }] }],
      },
    ]);
  });
});
