import { menusOf } from "@/domain/documents";
import type { Menu, ProjectId } from "@/domain/types";
import { getText } from "@/lib/i18n";
import { projectFromFiles } from "@/schema/projectFromFiles";
import { projectToFiles } from "@/schema/projectToFiles";
import { produce } from "immer";
import { describe, expect, it } from "vitest";
import {
  addVariant,
  createVersion,
  dropVersion,
  removeVariant,
  rulesFromYaml,
  rulesToYaml,
  showVariant,
  variantsHaving,
  versionOf,
  viewedVariant,
} from "./variants";

const PID = "p_guilds" as ProjectId;
const base = `plugins/Artisan/projects/${PID}`;
const files = {
  [`${base}/manifest.yaml`]: "schema: manifest/v1\n",
  [`${base}/variants.yml`]:
    "schema: variants/v1\nrules:\n  - variant: textured\n    when: { has_pack: true }\n",
  [`${base}/menus/ranks.yml`]: "schema: menu/v1\ntitle: Ranks\nsize: 27\n",
  [`${base}/menus/main.yml`]: "schema: menu/v1\ntitle: Main\nsize: 27\n",
  [`${base}/variants/textured/menus/ranks.yml`]: "schema: menu/v1\ntitle: Ranks T\nsize: 27\n",
};

const title = (p: ReturnType<typeof projectFromFiles>, id: string) => {
  const menu = menusOf(p).find((m) => m.id === id) as Menu;
  const layer = menu.title[0] as { value: { key: string } };
  return getText(p, layer.value as never, "en");
};

describe("variants in the editor", () => {
  it("View as puts a variant's versions in place, and back", () => {
    const p = projectFromFiles(PID, files);
    const viewed = produce(p, (d) => showVariant(d, "textured"));
    expect(viewedVariant(viewed)).toBe("textured");
    expect(title(viewed, "ranks")).toBe("Ranks T");
    expect(title(viewed, "main")).toBe("Main");
    expect(versionOf(viewed, "menu", "ranks")).toBe("textured");
    expect(versionOf(viewed, "menu", "main")).toBeUndefined();
    expect(variantsHaving(viewed, "menu", "ranks")).toEqual(["textured"]);
    // The files do not depend on the view.
    expect(projectToFiles(viewed)).toEqual(projectToFiles(p));
    const back = produce(viewed, (d) => showVariant(d, undefined));
    expect(title(back, "ranks")).toBe("Ranks");
    expect(menusOf(back).map((m) => m.id)).toEqual(menusOf(p).map((m) => m.id));
  });

  it("a new version is a copy whose texts are its own; dropping it brings the module's back", () => {
    const p = projectFromFiles(PID, files);
    let viewed = produce(p, (d) => {
      showVariant(d, "textured");
      expect(createVersion(d, "menu", "main")).toBe(true);
      const layer = (menusOf(d).find((m) => m.id === "main") as Menu).title[0] as {
        value: { key: string };
      };
      d.i18nKeys[layer.value.key as never] = { en: "Main T" };
    });
    expect(title(viewed, "main")).toBe("Main T");
    const out = projectToFiles(viewed);
    expect(out[`${base}/variants/textured/menus/main.yml`]).toContain("Main T");
    expect(out[`${base}/menus/main.yml`]).toContain("title: Main\n");
    viewed = produce(viewed, (d) => {
      expect(dropVersion(d, "menu", "main")).toBe(true);
    });
    expect(title(viewed, "main")).toBe("Main");
    expect(projectToFiles(viewed)[`${base}/variants/textured/menus/main.yml`]).toBeUndefined();
  });

  it("a version deleted in the view lets the module's Document come back", () => {
    const p = produce(projectFromFiles(PID, files), (d) => {
      showVariant(d, "textured");
      d.documents.menu = (d.documents.menu ?? []).filter((m) => m.id !== "ranks");
      showVariant(d, undefined);
    });
    expect(title(p, "ranks")).toBe("Ranks");
    expect(p.variants?.documents.textured?.menu ?? []).toEqual([]);
  });

  it("variants are added with a rule that is off, and removed with their versions", () => {
    const p = produce(projectFromFiles(PID, files), (d) => {
      expect(addVariant(d, "Bad name")).toBe(false);
      expect(addVariant(d, "vip")).toBe(true);
      expect(addVariant(d, "vip")).toBe(false);
    });
    expect(p.variants?.rules.at(-1)).toEqual({ variant: "vip", enabled: false });
    const gone = produce(p, (d) => removeVariant(d, "textured"));
    expect(gone.variants?.names).toEqual(["vip"]);
    expect(Object.keys(projectToFiles(gone)).some((k) => k.includes("variants/textured"))).toBe(
      false,
    );
  });

  it("rules read and write variants.yml as the plugin does", () => {
    const raw = {
      rules: [
        { id: "dev", variant: "dev", enabled: false, when: { permission: "op" } },
        { variant: "bedrock", when: { client: "bedrock" } },
        {
          variant: "vip",
          when: { has_pack: true, condition: { type: "has_permission", perm: "vip" } },
        },
      ],
    };
    expect(rulesToYaml(rulesFromYaml(raw))).toEqual({ schema: "variants/v1", ...raw });
  });
});
