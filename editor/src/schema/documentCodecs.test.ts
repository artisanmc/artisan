import { registerDocumentKind, resetDocumentKinds } from "@/domain/documentKinds";
import { documentsOf } from "@/domain/documents";
import type { Document, ProjectId } from "@/domain/types";
import { transform } from "@/features/export/transform";
import { parse } from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import { registerDocumentCodec, resetDocumentCodecs } from "./documentCodecs";
import { projectFromFiles } from "./projectFromFiles";

/**
 * The import and the export know no kind by name: a kind registered with its
 * codec is read from its folder and written back there, and a folder nobody
 * registered stays opaque module data (ADR `extensible-document-kinds`).
 */
afterEach(() => {
  resetDocumentKinds();
  resetDocumentCodecs();
});

const PID = "p1" as ProjectId;
const base = `plugins/Artisan/projects/${PID}`;

describe("document codecs", () => {
  it("round-trips a module's kind through its folder once kind and codec are registered", () => {
    registerDocumentKind({
      kind: "note",
      dir: "notes",
      idPrefix: "n_",
      schemaVersion: "note/v1",
      rank: 9,
    });
    registerDocumentCodec({
      kind: "note",
      parse: (src) => ({
        doc: { id: src.id, text: src.text } as unknown as Document,
        i18nKeys: {},
        unsupported: [],
      }),
      serialize: (doc) => ({
        schema: "note/v1",
        id: doc.id,
        text: (doc as unknown as { text: string }).text,
      }),
    });
    const project = projectFromFiles(PID, {
      [`${base}/manifest.yaml`]: "schema: manifest/v1\n",
      [`${base}/notes/hello.yaml`]: "schema: note/v1\ntext: hi\n",
    });
    expect(documentsOf(project, "note")).toEqual([{ id: "hello", text: "hi" }]);
    expect(project.moduleData).toBeUndefined();
    const files = transform(project);
    expect(parse(files[`${base}/notes/hello.yaml`]!)).toEqual({ schema: "note/v1", text: "hi" });
  });

  it("leaves the folder of an unregistered kind to moduleData", () => {
    const project = projectFromFiles(PID, {
      [`${base}/manifest.yaml`]: "schema: manifest/v1\n",
      [`${base}/notes/hello.yaml`]: "schema: note/v1\ntext: hi\n",
    });
    expect(project.documents.note).toBeUndefined();
    expect(project.moduleData).toEqual({
      notes: { __files: { "hello.yaml": "schema: note/v1\ntext: hi\n" } },
    });
  });
});
