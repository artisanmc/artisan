import { describe, expect, it } from "vitest";
import vector from "../../../testdata/doc-ref-conformance.json";
import { parseDocRef, projectNamespace, resolveDocRef } from "./docRef";

describe("parseDocRef", () => {
  it("reads a bare id as local to the referencing project", () => {
    expect(parseDocRef("main")).toEqual({ namespace: null, id: "main" });
  });

  it("reads `project:id` as a document of that project", () => {
    expect(parseDocRef("boutique:main")).toEqual({ namespace: "boutique", id: "main" });
  });

  it("splits at the first colon only", () => {
    expect(parseDocRef("a:b:c")).toEqual({ namespace: "a", id: "b:c" });
  });

  it("keeps a malformed ref whole instead of inventing a namespace or an empty id", () => {
    expect(parseDocRef(":main")).toEqual({ namespace: null, id: ":main" });
    expect(parseDocRef("shop:")).toEqual({ namespace: null, id: "shop:" });
  });
});

describe("resolveDocRef — shared vector with the plugin", () => {
  const candidates = (id: string) =>
    vector.documents
      .filter((d) => d.id === id)
      .map((d) => ({ namespace: d.project, projectId: d.project, id: d.id }));

  for (const c of vector.cases) {
    it(`${c.ref} from ${c.from ?? "nowhere"} → ${c.expect}`, () => {
      const hits = resolveDocRef(candidates, c.from, c.ref);
      const got =
        hits.length === 0
          ? "missing"
          : hits.length > 1
            ? "ambiguous"
            : `${hits[0]!.namespace}:${hits[0]!.id}`;
      expect(got).toBe(c.expect);
    });
  }
});

describe("projectNamespace", () => {
  it("is the on-disk folder, which may differ from the internal id", () => {
    expect(projectNamespace({ id: "internal-1", diskId: "boutique" })).toBe("boutique");
    expect(projectNamespace({ id: "core" })).toBe("core");
  });
});
