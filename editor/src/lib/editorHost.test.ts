import type { Project } from "@/domain/types";
import { describe, expect, it } from "vitest";
import { serverDocuments } from "./editorHost";

const project = (id: string, documents: Record<string, { id: string }[]>, diskId?: string) =>
  ({ id, diskId, documents }) as unknown as Project;

describe("serverDocuments", () => {
  it("lists a kind across the open project and the other published ones", () => {
    const village = project("p-1", { npc: [{ id: "bruno" }] }, "village");
    const conversations = project("conversations", {
      conversation_speaker: [{ id: "bruno" }, { id: "marthe" }],
    });
    expect(serverDocuments([village], [conversations], "conversation_speaker")).toEqual([
      {
        projectId: "conversations",
        namespace: "conversations",
        project: conversations,
        document: { id: "bruno" },
      },
      {
        projectId: "conversations",
        namespace: "conversations",
        project: conversations,
        document: { id: "marthe" },
      },
    ]);
    expect(serverDocuments([village], [conversations], "npc")).toEqual([
      { projectId: "p-1", namespace: "village", project: village, document: { id: "bruno" } },
    ]);
  });

  it("reads an open project as it is being edited, not its published copy", () => {
    const edited = project("p-1", { npc: [{ id: "bruno" }, { id: "new" }] }, "village");
    const published = project("village", { npc: [{ id: "bruno" }] });
    expect(
      serverDocuments([edited], [published], "npc").map((d) => (d.document as { id: string }).id),
    ).toEqual(["bruno", "new"]);
  });
});
