import { commandsOf, menusOf } from "@/domain/documents";
import type { Menu, ProjectId } from "@/domain/types";
import { getText } from "@/lib/i18n";
import { projectFromFiles } from "@/schema/projectFromFiles";
import { projectToFiles } from "@/schema/projectToFiles";
import { produce } from "immer";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { isRequired, originStatus, revertToOriginal } from "./originals";
import { showOriginal, showVariant, viewedVariant } from "./variants";

const PID = "p_originals" as ProjectId;
const base = `plugins/Artisan/projects/${PID}`;

const files = {
  [`${base}/artisan-module.yml`]: "schema: module/v1\ndefault_lang: en\nlanguages: [en]\n",
  [`${base}/originals/originals.yml`]: "module: guilds\nversion: 1\nrequired: [menus/main.yml]\n",
  [`${base}/originals/menus/main.yml`]: "schema: menu/v1\ntitle: Main\nsize: 27\n",
  [`${base}/originals/menus/ranks.yml`]: "schema: menu/v1\ntitle: Ranks\nsize: 27\n",
  [`${base}/originals/commands/guild.yml`]: "schema: command/v1\nactions:\n  - open_menu: main\n",
  [`${base}/originals/variants.yml`]: "schema: variants/v1\nrules:\n  - variant: textured\n",
  [`${base}/originals/variants/textured/menus/main.yml`]:
    "schema: menu/v1\ntitle: Main T\nsize: 27\n",
  [`${base}/menus/ranks.yml`]: "schema: menu/v1\ntitle: My ranks\nsize: 27\n",
};

const title = (p: ReturnType<typeof projectFromFiles>, id: string) => {
  const menu = menusOf(p).find((m) => m.id === id) as Menu;
  const layer = menu.title[0] as { value: { key: string } };
  return getText(p, layer.value as never, "en");
};

const rel = (out: Record<string, string>) =>
  Object.keys(out)
    .map((k) => k.slice(base.length + 1))
    .sort();

describe("a module's originals in the editor (design originaux-modules)", () => {
  it("reads the originals under the owner's files, writes only what differs", () => {
    const project = projectFromFiles(PID, files);
    expect(menusOf(project).map((m) => m.id)).toEqual(["main", "ranks"]);
    expect(commandsOf(project).map((c) => c.id)).toEqual(["guild"]);
    expect(originStatus(project, "menu", "main")).toBe("original");
    expect(originStatus(project, "menu", "ranks")).toBe("modified");
    expect(project.variants?.names).toEqual(["textured"]);
    const out = projectToFiles(project);
    const written = rel(out).filter((p) => !p.startsWith("lang/") && !p.startsWith(".artisan"));
    expect(written).toEqual(["artisan-module.yml", "menus/ranks.yml"]);
    expect(projectToFiles(projectFromFiles(PID, { ...files, ...out }))).toEqual(out);
  });

  it("an edit makes a Document the owner's, going back makes it the original", () => {
    let project = produce(projectFromFiles(PID, files), (p) => {
      menusOf(p).find((m) => m.id === "main")!.rows = 6;
    });
    expect(originStatus(project, "menu", "main")).toBe("modified");
    expect(parse(projectToFiles(project)[`${base}/menus/main.yml`]!).size).toBe(54);
    project = produce(project, (p) => {
      expect(revertToOriginal(p, "menu", "main")).toBe(true);
      revertToOriginal(p, "menu", "ranks");
    });
    expect(originStatus(project, "menu", "ranks")).toBe("original");
    const written = rel(projectToFiles(project));
    expect(written).not.toContain("menus/main.yml");
    expect(written).not.toContain("menus/ranks.yml");
  });

  it("a shipped Document left out is excluded, a required one cannot be", () => {
    const base0 = projectFromFiles(PID, files);
    expect(isRequired(base0, "menu", "main")).toBe(true);
    expect(isRequired(base0, "menu", "ranks")).toBe(false);
    const project = produce(base0, (p) => {
      p.documents.command = [];
      p.documents.menu = (p.documents.menu ?? []).filter((m) => m.id !== "main");
    });
    const manifest = parse(projectToFiles(project)[`${base}/artisan-module.yml`]!);
    expect(manifest.originals).toEqual({ exclude: ["commands/guild.yml"] });
    const again = projectFromFiles(PID, {
      ...files,
      [`${base}/artisan-module.yml`]: projectToFiles(project)[`${base}/artisan-module.yml`]!,
    });
    expect(commandsOf(again)).toEqual([]);
    expect(menusOf(again).map((m) => m.id)).toEqual(["main", "ranks"]);
  });

  it("the module's variant versions and rules stay the module's until changed", () => {
    const project = produce(projectFromFiles(PID, files), (p) => {
      showVariant(p, "textured");
    });
    expect(originStatus(project, "menu", "main")).toBe("original");
    const out = rel(projectToFiles(project));
    expect(out).not.toContain("variants.yml");
    expect(out.some((p) => p.startsWith("variants/"))).toBe(false);
    const edited = produce(project, (p) => {
      menusOf(p).find((m) => m.id === "main")!.rows = 6;
    });
    expect(originStatus(edited, "menu", "main")).toBe("modified");
    expect(rel(projectToFiles(edited))).toContain("variants/textured/menus/main.yml");
  });

  it("View as the original shows what the module ships, in the variant viewed, and back", () => {
    const start = projectFromFiles(PID, files);
    const shown = produce(start, (p) => showOriginal(p, true));
    expect(title(shown, "ranks")).toBe("Ranks");
    expect(title(shown, "main")).toBe("Main");
    expect(rel(projectToFiles(shown))).toEqual(rel(projectToFiles(start)));
    const back = produce(shown, (p) => showOriginal(p, false));
    expect(back.originalView).toBeUndefined();
    expect(title(back, "ranks")).toBe("My ranks");

    // In a variant: its shipped versions over the shipped Documents; closing shows it again.
    const textured = produce(start, (p) => {
      showVariant(p, "textured");
      showOriginal(p, true);
    });
    expect(title(textured, "main")).toBe("Main T");
    expect(title(textured, "ranks")).toBe("Ranks");
    expect(textured.originalView?.variant).toBe("textured");
    const closed = produce(textured, (p) => showOriginal(p, false));
    expect(viewedVariant(closed)).toBe("textured");
    expect(title(closed, "ranks")).toBe("My ranks");
  });
});
