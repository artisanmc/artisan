// @vitest-environment node
// The command files Artisan generates from a module's declarations (plugin
// `ModuleCommandFiles`, shared vector) must come back byte for byte from the
// editor: a Deploy rewrites every file it reads, and a generated file written
// differently would count as edited and stop following the module.
import { describe, expect, it } from "vitest";
import vector from "../../../testdata/module-command-files.json";
import { projectFromFiles } from "./projectFromFiles";
import { projectToFiles } from "./projectToFiles";

const base = "plugins/Artisan/projects/p_module";
const MANIFEST = "schema: manifest/v1\ndefault_lang: fr\nlanguages: [fr, en]\n";

describe("generated module command files", () => {
  for (const { id, yaml } of vector.files) {
    it(`${id}.yaml is written back unchanged`, () => {
      const path = `${base}/commands/${id}.yaml`;
      const files = { [`${base}/manifest.yaml`]: MANIFEST, [path]: yaml };
      const out = projectToFiles(projectFromFiles("p_module" as never, files));
      expect(out[path]).toBe(yaml);
    });
  }
});
