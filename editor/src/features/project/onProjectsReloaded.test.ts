import { projectCacheKey, useProjectCacheStore } from "@/state/projectCacheStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { beforeEach, describe, expect, it } from "vitest";
import { onProjectsReloaded } from "./onProjectsReloaded";

const KEY = projectCacheKey("boutique", "srv");

function seedCache(hash: string) {
  useProjectCacheStore.getState().put(KEY, {
    identity: {},
    diskId: "boutique",
    serverKeyId: "sk_1",
    tree: { "a.yaml": "x" },
    hash,
    fetchedAt: new Date().toISOString(),
  } as never);
}

function seedDraft(dirty: boolean) {
  useProjectDraftStore.setState({
    drafts: {
      p1: {
        baseline: { "a.yaml": "x" },
        initialTree: { "a.yaml": "x" },
        tree: { "a.yaml": dirty ? "modifié" : "x" },
      },
    },
  } as never);
}

/**
 * The plugin announces its reloads: the only moment a hand edit on the disk
 * becomes real. The editor reacts as discreetly as possible — and above all,
 * never throws away work in progress to fetch fresh data.
 */
describe("onProjectsReloaded", () => {
  beforeEach(() => {
    useProjectCacheStore.setState({ entries: {}, reloadToken: 0 } as never);
    useProjectDraftStore.setState({ drafts: {} } as never);
  });

  it("relit quand l'empreinte annoncée diffère de celle qu'on détient", () => {
    seedCache("ancienne");
    onProjectsReloaded("sk_1", [{ id: "boutique", hash: "nouvelle" }]);
    expect(useProjectCacheStore.getState().reloadToken).toBe(1);
  });

  /** Nothing changed for us: re-reading would cost a round trip for nothing. */
  it("ne relit pas quand l'empreinte annoncée est celle qu'on a déjà", () => {
    seedCache("identique");
    onProjectsReloaded("sk_1", [{ id: "boutique", hash: "identique" }]);
    expect(useProjectCacheStore.getState().reloadToken).toBe(0);
  });

  /**
   * Unsaved work exists nowhere else. An automatic re-read would replace it
   * without being asked — exactly what the Refresh button asks to confirm.
   */
  it("ne touche à rien tant qu'il y a du travail non enregistré, où qu'il soit", () => {
    seedCache("ancienne");
    seedDraft(true);
    onProjectsReloaded("sk_1", [{ id: "boutique", hash: "nouvelle" }]);
    expect(useProjectCacheStore.getState().reloadToken).toBe(0);
    expect(useProjectDraftStore.getState().drafts.p1).toBeDefined();
  });

  it("un brouillon propre ne bloque pas la relecture", () => {
    seedCache("ancienne");
    seedDraft(false);
    onProjectsReloaded("sk_1", [{ id: "boutique", hash: "nouvelle" }]);
    expect(useProjectCacheStore.getState().reloadToken).toBe(1);
  });

  it("une annonce qui ne concerne aucun Project connu ne relit rien", () => {
    seedCache("ancienne");
    onProjectsReloaded("sk_1", [{ id: "un_autre", hash: "peu importe" }]);
    expect(useProjectCacheStore.getState().reloadToken).toBe(0);
  });
});
