// @vitest-environment node
// Round trip of the file codec, per Document kind and for data sources. Inputs
// are the published schema examples (docs/schema/*/v1/examples), the same
// vectors the plugin and the JSON schemas are held to. Some still use legacy
// spellings (`layers`, `{steps}` click objects, inline `fields:`), which the
// first read canonicalizes; from there, domain → files → domain must give the
// same Project back and the files written twice must be identical:
//   example → P1 → F1 → P2 → F2 → P3, with P3 = P2 and F2 = F1.
import { readFileSync, readdirSync } from "node:fs";
import { documentsOf } from "@/domain/documents";
import type { Project, ProjectId } from "@/domain/types";
import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { projectFromFiles } from "./projectFromFiles";
import { projectToFiles } from "./projectToFiles";

const PID = "p_codec" as ProjectId;
const base = `plugins/Artisan/projects/${PID}`;
const MANIFEST = "schema: manifest/v1\ndefault_lang: fr\nlanguages: [fr, en]\n";

const examplesDir = new URL("../../../docs/schema/", import.meta.url);

function examples(kind: string): Array<[string, string]> {
  const dir = new URL(`${kind}/v1/examples/`, examplesDir);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json") || name.endsWith(".yaml"))
    .sort()
    .map((name) => [name, readFileSync(new URL(name, dir), "utf8")]);
}

/** A file tree holding one document, as the server would store it. */
function treeWith(path: string, content: string): Record<string, string> {
  return { [`${base}/manifest.yaml`]: MANIFEST, [`${base}/${path}`]: content };
}

/** The parts of a Project the files carry (timestamps and open-time metadata excluded). */
function content(p: Project) {
  return {
    documents: p.documents,
    i18nKeys: p.i18nKeys,
    defaultLang: p.defaultLang,
    dataSources: p.dataSources,
    dataModels: p.dataModels,
  };
}

function roundTrip(files: Record<string, string>) {
  const p1 = projectFromFiles(PID, files);
  const f1 = projectToFiles(p1);
  const p2 = projectFromFiles(PID, f1);
  const f2 = projectToFiles(p2);
  const p3 = projectFromFiles(PID, f2);
  return { p1, f1, p2, f2, p3 };
}

/** A document file of the examples: JSON on the wire, without its `id` (the file name). */
function docFile(json: string): { id: string; yaml: string } {
  const { id, ...rest } = JSON.parse(json) as { id: string } & Record<string, unknown>;
  return { id, yaml: stringify(rest) };
}

describe("codec round trip — menu/v1 examples", () => {
  for (const [name, json] of examples("menu")) {
    it(name, () => {
      const { id, yaml } = docFile(json);
      const { p1, p2, p3, f1, f2 } = roundTrip(treeWith(`menus/${id}.yaml`, yaml));
      expect(documentsOf(p1, "menu")).toHaveLength(1);
      expect(content(p3)).toEqual(content(p2));
      expect(f2).toEqual(f1);
    });
  }
});

describe("codec round trip — command/v1 examples", () => {
  for (const [name, json] of examples("command")) {
    it(name, () => {
      const { id, yaml } = docFile(json);
      const { p1, p2, p3, f1, f2 } = roundTrip(treeWith(`commands/${id}.yaml`, yaml));
      expect(documentsOf(p1, "command")).toHaveLength(1);
      expect(content(p3)).toEqual(content(p2));
      expect(f2).toEqual(f1);
    });
  }
});

// No dialog/v1 example is published (docs/schema/dialog/v1 holds only the
// schema): this file exercises every body, input and button form it declares.
const DIALOG = `schema: dialog/v1
title:
  fr: Confirmer l'achat
  en: Confirm purchase
can_close_with_escape: false
body:
  - type: text
    text: Voulez-vous acheter {item} ?
  - type: item
    material: DIAMOND
    count: 2
inputs:
  - id: name
    type: text
    label: Nom
    default: Steve
    max_length: 16
  - id: gift
    type: bool
    label: Cadeau
    default: "true"
  - id: qty
    type: number_range
    label: Quantité
    min: 1
    max: 64
    default: "1"
  - id: color
    type: single_option
    label: Couleur
    options:
      - value: red
        label: Rouge
      - value: blue
        label: Bleu
    default: red
buttons:
  - id: ok
    label: OK
    actions:
      - type: send_message
        text: Merci !
  - id: cancel
    label: Annuler
`;

describe("codec round trip — dialog/v1", () => {
  it("every body, input and button form", () => {
    const { p1, p2, p3, f1, f2 } = roundTrip(treeWith("dialogs/confirm.yaml", DIALOG));
    expect(documentsOf(p1, "dialog")).toHaveLength(1);
    expect(content(p3)).toEqual(content(p2));
    expect(f2).toEqual(f1);
  });
});

// Known bug, pinned so its fix flips this test: an owned table model whose id
// differs from its source's id (`mdl_ranks` here, `dm_…` for every table the
// editor creates) is written at models/<sourceId>.yaml with `id: <modelId>`,
// but `projectFromFiles` indexes models/ files by that inner id, so the lookup
// beside the data (by file name) misses: the rows come back untyped against a
// synthesized empty model, and the next write blanks every ltext value.
const KNOWN_LOSSY = new Set(["ranks.yaml"]);

describe("codec round trip — data/v1 examples", () => {
  for (const [name, yaml] of examples("data")) {
    (KNOWN_LOSSY.has(name) ? it.fails : it)(name, () => {
      const id = (parse(yaml) as { id: string }).id;
      const { p1, p2, p3, f1, f2 } = roundTrip(treeWith(`data/${id}.yaml`, yaml));
      expect(p1.dataSources ?? []).toHaveLength(1);
      expect(content(p3)).toEqual(content(p2));
      expect(f2).toEqual(f1);
    });
  }
});
