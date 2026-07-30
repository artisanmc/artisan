import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "../../db/index";
import { networks, projects, serverKeys } from "../../db/schema";
import { generateServerKey } from "../../lib/auth";
import { createNetwork } from "../../lib/networkManager";
import { createProject, getProject, upsertProjectContent } from "../../lib/projectStorage";
import { parse } from "yaml";
import { applyBoutiqueAdditem, type BoutiqueAdditemPayload } from "./index";

const STACK = "==: org.bukkit.inventory.ItemStack\nv: 4325\ntype: DIAMOND_SWORD\n";

const payload = (over: Partial<BoutiqueAdditemPayload> = {}): BoutiqueAdditemPayload => ({
  item_id: "epee",
  price: 100,
  category: "Armes",
  stack_yaml: STACK,
  display: { material: "DIAMOND_SWORD", name: "Épée de test" },
  ...over,
});

/** Declared Table + a PRE-BARE row whose `name` is a lang KEY, with the lang
 *  file in its canonical nested form. */
async function seedProject(langYaml: string, rowName: string, rowId = "armes") {
  const net = await createNetwork("N");
  const { id: keyId, hash } = await generateServerKey();
  await db.insert(serverKeys).values({
    id: keyId,
    hash,
    label: null,
    networkId: net.id,
    createdAt: new Date(),
  });
  const project = await createProject({
    networkId: net.id,
    serverKeyId: keyId,
    name: "Boutique",
    id: "p_boutique",
  });
  const base = `plugins/Artisan/projects/${project.id}`;
  const files: Record<string, string> = {
    [`${base}/manifest.yaml`]:
      "schema: manifest/v1\nproject_id: p_boutique\ndefault_lang: fr\nlanguages: [fr]\nfiles:\n  menus: []\n  commands: []\n  dialogs: []\n",
    [`${base}/data/categories/_source.yaml`]: `model: boutique:category\norder: [${rowId}]\n`,
    [`${base}/data/categories/${rowId}.yaml`]: `id: ${rowId}\nname: ${rowName}\nitems: []\n`,
    [`${base}/lang/fr.yaml`]: langYaml,
  };
  await upsertProjectContent(project.id, { hash: "h0", filesJson: JSON.stringify(files) });
  return { keyId, base };
}

async function storedFiles(): Promise<Record<string, string>> {
  const p = await getProject("p_boutique");
  return JSON.parse(p!.filesJson) as Record<string, string>;
}

describe("boutique additem — lang files are YAML trees", () => {
  beforeEach(async () => {
    await db.delete(projects);
    await db.delete(serverKeys);
    await db.delete(networks);
  });

  test("matches a category by NAME through a nested lang file (id does not match)", async () => {
    // Row id `cat_1` ≠ the requested category "Armes": the match can only come
    // from resolving the row's name KEY through lang/fr.yaml.
    const { keyId, base } = await seedProject(
      "sources:\n  categories:\n    cat_1:\n      name: Armes\n",
      "sources.categories.cat_1.name",
      "cat_1",
    );

    const result = await applyBoutiqueAdditem(keyId, payload());
    expect(result.ok).toBe(true);

    // Resolved "Armes" → the existing row was reused, not a new category.
    const files = await storedFiles();
    const row = parse(files[`${base}/data/categories/cat_1.yaml`]!) as {
      items: Array<{ id: string; price: number }>;
    };
    expect(row.items.map((i) => i.id)).toEqual(["epee"]);
    expect(row.items[0]!.price).toBe(100);
  });

  test("rewrites a legacy key's translation in place and keeps the file nested", async () => {
    const { keyId, base } = await seedProject(
      "sources:\n  categories:\n    armes:\n      name: Armes\n      items:\n        epee:\n          name: Vieux nom\n",
      "sources.categories.armes.name",
    );
    // Pre-existing item whose name is a lang key → the update must land in lang/.
    const before = await storedFiles();
    before[`${base}/data/categories/armes.yaml`] =
      "id: armes\nname: sources.categories.armes.name\nitems:\n  - id: epee\n    name: sources.categories.armes.items.epee.name\n    icon: 'item:old'\n    price: 10\n    discount: 0\n    lore: []\n    actions: ''\n";
    await upsertProjectContent("p_boutique", {
      hash: "h1",
      filesJson: JSON.stringify(before),
    });

    const result = await applyBoutiqueAdditem(keyId, payload({ display: { name: "Épée neuve" } }));
    expect(result.ok).toBe(true);

    const files = await storedFiles();
    const raw = files[`${base}/lang/fr.yaml`]!;
    // Still a tree — no dotted key at the root.
    expect(raw).toMatch(/^sources:\n/);
    expect(raw).not.toMatch(/^sources\./m);
    const tree = parse(raw) as { sources: { categories: { armes: Record<string, unknown> } } };
    const armes = tree.sources.categories.armes as {
      name: string;
      items: { epee: { name: string } };
    };
    expect(armes.items.epee.name).toBe("Épée neuve");
    expect(armes.name).toBe("Armes");
  });
});
