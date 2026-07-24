import { describe, expect, test } from "vitest";
import { readOwnerModuleFromFiles } from "./projectFiles";

const PACK_ID = "pack_test";
const base = `plugins/Artisan/projects/${PACK_ID}`;

describe("readOwnerModuleFromFiles", () => {
  test("reads manifest.module", () => {
    const files = {
      [`${base}/manifest.yaml`]: `schema: manifest/v1\nproject_id: ${PACK_ID}\nmodule: boutique\n`,
    };
    expect(readOwnerModuleFromFiles(files, PACK_ID)).toBe("boutique");
  });

  test("no module / missing manifest → undefined", () => {
    const noModule = {
      [`${base}/manifest.yaml`]: `schema: manifest/v1\nproject_id: ${PACK_ID}\n`,
    };
    expect(readOwnerModuleFromFiles(noModule, PACK_ID)).toBeUndefined();
    expect(readOwnerModuleFromFiles({}, PACK_ID)).toBeUndefined();
  });

  test("corrupt manifest → undefined", () => {
    const corrupt = { [`${base}/manifest.yaml`]: "{{{not yaml" };
    expect(readOwnerModuleFromFiles(corrupt, PACK_ID)).toBeUndefined();
  });
});
