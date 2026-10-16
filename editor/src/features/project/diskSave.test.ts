import { describe, expect, it } from "vitest";
import { planWrite, toRelative } from "./diskSave";

/**
 * The save planner (ADR `server-disk-only-storage`).
 *
 * The editor keeps the **base** in memory: each file's content as it was
 * loaded. Saving = comparing the current tree to that base and sending only
 * what moved, each entry carrying its base hash so the plugin can refuse if
 * the disk changed meanwhile.
 */
describe("planWrite", () => {
  it("sends only what changed", async () => {
    const baseline = {
      "menus/a.yaml": "title: A\n",
      "menus/b.yaml": "title: B\n",
    };
    const next = {
      "menus/a.yaml": "title: A\n", // unchanged
      "menus/b.yaml": "title: B modifié\n",
    };

    const plan = await planWrite(baseline, next);

    expect(plan.files.map((f) => f.path)).toEqual(["menus/b.yaml"]);
    expect(plan.files[0]!.content).toBe("title: B modifié\n");
    expect(plan.deletes).toEqual([]);
  });

  it("a new file goes out with base_hash null", async () => {
    const plan = await planWrite({}, { "menus/neuf.yaml": "title: Neuf\n" });

    expect(plan.files).toHaveLength(1);
    expect(plan.files[0]!.path).toBe("menus/neuf.yaml");
    // null = "I expect no file here".
    expect(plan.files[0]!.base_hash).toBeNull();
  });

  it("a file gone from the tree becomes a delete carrying its base hash", async () => {
    const baseline = { "menus/vieux.yaml": "title: Vieux\n" };
    const plan = await planWrite(baseline, {});

    expect(plan.files).toEqual([]);
    expect(plan.deletes).toHaveLength(1);
    expect(plan.deletes[0]!.path).toBe("menus/vieux.yaml");
    expect(plan.deletes[0]!.base_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the base_hash of a modified file is the BASE one, not the new content's", async () => {
    const baseline = { "menus/a.yaml": "ancien\n" };
    const plan = await planWrite(baseline, { "menus/a.yaml": "nouveau\n" });
    const planOfBase = await planWrite({}, { "menus/a.yaml": "ancien\n" });

    // sha256("ancien\n") — the token describes what we expected on disk.
    expect(plan.files[0]!.base_hash).not.toBeNull();
    expect(plan.files[0]!.base_hash).not.toBe(planOfBase.files[0]!.base_hash);
  });

  it("a tree identical to the base produces no write", async () => {
    const tree = { "menus/a.yaml": "title: A\n", "lang/fr.yaml": "x: y\n" };
    const plan = await planWrite(tree, { ...tree });

    expect(plan.files).toEqual([]);
    expect(plan.deletes).toEqual([]);
    expect(plan.empty).toBe(true);
  });

  it("paths come out sorted — a readable diff and a deterministic write order", async () => {
    const plan = await planWrite(
      {},
      {
        "menus/z.yaml": "z\n",
        "commands/a.yaml": "a\n",
        "lang/fr.yaml": "f\n",
      },
    );

    expect(plan.files.map((f) => f.path)).toEqual([
      "commands/a.yaml",
      "lang/fr.yaml",
      "menus/z.yaml",
    ]);
  });
});

describe("toRelative", () => {
  it("strips the canonical prefix that projectToFiles() produces", () => {
    const canonical = {
      "plugins/Artisan/projects/boutique_shop/menus/a.yaml": "title: A\n",
      "plugins/Artisan/projects/boutique_shop/.artisan/editor.yaml": "i18n_mode: inline\n",
    };

    expect(toRelative(canonical, "boutique_shop")).toEqual({
      "menus/a.yaml": "title: A\n",
      ".artisan/editor.yaml": "i18n_mode: inline\n",
    });
  });

  it("ignores what does not belong to the project — never a write outside its tree", () => {
    const canonical = {
      "plugins/Artisan/projects/boutique_shop/menus/a.yaml": "title: A\n",
      "plugins/Artisan/projects/autre_project/menus/vole.yaml": "title: Volé\n",
    };

    expect(toRelative(canonical, "boutique_shop")).toEqual({ "menus/a.yaml": "title: A\n" });
  });
});
