import { menusOf } from "@/domain/documents";
import { isRequired, originStatus, revertToOriginal } from "@/domain/originals";
import type { ProjectId } from "@/domain/types";
import { projectFromFiles } from "@/schema/projectFromFiles";
import { projectToFiles } from "@/schema/projectToFiles";
import { produce } from "immer";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { adoptShippedTwins, shippedTemplates, shippedTwinsOf } from "./shippedTwins";

const PID = "p_tree" as ProjectId;
const base = `plugins/Artisan/projects/${PID}`;

const index = [
  "files:",
  "  menus/main.yml: { module: guilds, template: system, version: 1, hash: a, required: true }",
  "  menus/ranks.yml: { module: guilds, template: system, version: 1, hash: b }",
  "  menus/gone.yml: { module: guilds, template: examples, version: 1, hash: c }",
  "",
].join("\n");

const files = {
  [`${base}/artisan-module.yml`]: "schema: module/v1\ndefault_lang: en\nlanguages: [en]\n",
  [`${base}/artisan-shipped.yml`]: index,
  [`${base}/menus/main.yml`]: "schema: menu/v1\ntitle: Main\nsize: 27\n",
  [`${base}/menus/ranks.yml`]: "schema: menu/v1\ntitle: My ranks\nsize: 27\n",
};

const system = {
  "menus/main.yml": "schema: menu/v1\ntitle: Main\nsize: 27\n",
  "menus/ranks.yml": "schema: menu/v1\ntitle: Ranks\nsize: 27\n",
  // Shipped since the folder's last sync: not the folder's yet.
  "menus/new.yml": "schema: menu/v1\ntitle: New\nsize: 27\n",
};
const examples = { "menus/gone.yml": "schema: menu/v1\ntitle: Gone\nsize: 27\n" };

const rel = (out: Record<string, string>) =>
  Object.keys(out)
    .map((k) => k.slice(base.length + 1))
    .filter((p) => !p.startsWith("lang/") && !p.startsWith(".artisan"))
    .sort();

describe("a folder that holds its module's whole tree (ADR editable-module-tree)", () => {
  it("reads every Document as the owner's file and writes each one whole", () => {
    const project = projectFromFiles(PID, files);
    expect(project.originals?.inTree).toBe(true);
    expect(project.originals?.module).toBe("guilds");
    expect(project.originals?.required).toEqual(["menus/main.yml"]);
    expect(shippedTemplates(project)).toEqual([
      { module: "guilds", template: "system" },
      { module: "guilds", template: "examples" },
    ]);
    // Nothing said before the shipped versions arrive.
    expect(originStatus(project, "menu", "main")).toBeUndefined();
    const out = projectToFiles(project);
    expect(rel(out)).toEqual(["artisan-module.yml", "menus/main.yml", "menus/ranks.yml"]);
    expect(parse(out[`${base}/artisan-module.yml`]!).originals).toBeUndefined();
  });

  it("compares with the shipped versions, goes back to one, still writes it", () => {
    const loaded = projectFromFiles(PID, files);
    let project = produce(loaded, (p) => {
      adoptShippedTwins(p, shippedTwinsOf(loaded, [system, examples]));
    });
    expect(originStatus(project, "menu", "main")).toBe("original");
    expect(originStatus(project, "menu", "ranks")).toBe("modified");
    expect(isRequired(project, "menu", "main")).toBe(true);
    expect(isRequired(project, "menu", "ranks")).toBe(false);
    project = produce(project, (p) => {
      expect(revertToOriginal(p, "menu", "ranks")).toBe(true);
    });
    expect(originStatus(project, "menu", "ranks")).toBe("original");
    const out = projectToFiles(project);
    expect(rel(out)).toContain("menus/ranks.yml");
    expect(parse(out[`${base}/menus/ranks.yml`]!).title).toBe("Ranks");
    // A Document the server wrote and the owner no longer has is excluded; one the module
    // ships since the last sync is not.
    expect(parse(out[`${base}/artisan-module.yml`]!).originals).toEqual({
      exclude: ["menus/gone.yml"],
    });
  });

  it("a deleted optional Document is excluded once its shipped version is known", () => {
    const loaded = projectFromFiles(PID, files);
    const project = produce(loaded, (p) => {
      adoptShippedTwins(p, shippedTwinsOf(loaded, [system, examples]));
      p.documents.menu = menusOf(p).filter((m) => m.id !== "ranks");
    });
    const manifest = parse(projectToFiles(project)[`${base}/artisan-module.yml`]!);
    expect(manifest.originals).toEqual({ exclude: ["menus/gone.yml", "menus/ranks.yml"] });
  });

  it("keeps the index out of the owner's files", () => {
    const project = projectFromFiles(PID, files);
    expect(rel(projectToFiles(project))).not.toContain("artisan-shipped.yml");
  });
});
