import { createHash, webcrypto } from "node:crypto";
import { visitMenuLTexts } from "@/domain/i18nSites";
import { projectId } from "@/domain/ids";
import { useAccountStore } from "@/state/accountStore";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  applyMigrationProposal,
  canPersistMigrationDraft,
  inspectMigrationProposal,
} from "./migrationProposal";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
const menu = {
  schema: "menu/v1",
  id: "shop",
  title: "Shop",
  size: 9,
  elements: [
    {
      id: "item",
      positions: "0",
      material: "STONE",
      title: "Buy",
      lore: ["Line one", "Line two"],
      click: { left: 'send_message "Hello"' },
    },
  ],
};
function proposal(raw: Record<string, unknown> = structuredClone(menu)) {
  return {
    id: "proposal1",
    stepId: "step1",
    targetId: "shop",
    baseHash: null,
    resultHash: createHash("sha256").update(canonical(raw)).digest("hex"),
    menu: raw,
    issues: [],
  };
}
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  // biome-ignore lint/suspicious/noExplicitAny: isolated minimal account fixture
  useAccountStore.getState().setAccount({ id: "test" as any, projects: [], projectOrder: [] });
  useAccountStore.getState().createProject({ id: "p" });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("applies once and recognizes the same semantic result after account reload despite random i18n keys", async () => {
  const result = proposal();
  expect(inspectMigrationProposal(result, "p").status).toBe("available");
  expect((await applyMigrationProposal(result, "p")).status).toBe("applied");
  const snapshot = structuredClone(useAccountStore.getState().account);
  useAccountStore.getState().setAccount(snapshot);
  expect(inspectMigrationProposal(result, "p").status).toBe("already_applied");
  expect((await applyMigrationProposal(result, "p")).status).toBe("already_applied");
  expect(useAccountStore.getState().account.projects[0].menus).toHaveLength(1);
});

test("a translation edited in any language becomes a conflict and is never overwritten", async () => {
  const result = proposal();
  await applyMigrationProposal(result, "p");
  const project = useAccountStore.getState().account.projects[0];
  const site = [...visitMenuLTexts(project.menus[0])][0];
  useAccountStore.getState().setI18nValue({
    projectId: projectId("p"),
    lt: site.lText,
    lang: "fr",
    value: "Titre modifié",
  });
  expect(inspectMigrationProposal(result, "p").status).toBe("conflict");
  expect((await applyMigrationProposal(result, "p")).status).toBe("conflict");
  expect(useAccountStore.getState().account.projects[0].i18nKeys[site.lText.key].fr).toBe(
    "Titre modifié",
  );
});

test("rechecks the live target after hashing and snapshots the proposal immutably", async () => {
  const nativeDigest = crypto.subtle.digest.bind(crypto.subtle);
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(crypto.subtle, "digest").mockImplementationOnce(async (algorithm, data) => {
    await gate;
    return nativeDigest(algorithm, data);
  });
  const result = proposal();
  const pending = applyMigrationProposal(result, "p");
  useAccountStore
    .getState()
    .applyAssistantMenu({ projectId: projectId("p"), menuV1: { ...menu, size: 18 }, lang: "en" });
  result.menu.size = 54;
  release();
  expect((await pending).status).toBe("conflict");
  expect(useAccountStore.getState().account.projects[0].menus[0].rows).toBe(2);
});

test("hash mismatch, unknown Project and unsupported converter output do not mutate the draft", async () => {
  expect(
    (await applyMigrationProposal({ ...proposal(), resultHash: "0".repeat(64) }, "p")).status,
  ).toBe("blocked");
  expect((await applyMigrationProposal(proposal(), "missing")).status).toBe("blocked");
  const unsupported = proposal({
    ...menu,
    elements: [{ ...menu.elements[0], click: { left: "give_effect SPEED" } }],
  });
  expect((await applyMigrationProposal(unsupported, "p")).status).toBe("blocked");
  expect(useAccountStore.getState().account.projects[0].menus).toHaveLength(0);
});

test("does not apply after the owning view changes while hash verification is pending", async () => {
  let current = true;
  const pending = applyMigrationProposal(proposal(), "p", { isCurrent: () => current });
  current = false;
  expect((await pending).status).toBe("blocked");
  expect(useAccountStore.getState().account.projects[0].menus).toHaveLength(0);
});

test("reports unavailable browser persistence without hiding a successful draft application", async () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  expect(canPersistMigrationDraft()).toBe(false);
  const result = await applyMigrationProposal(proposal(), "p");
  expect(result).toEqual({ status: "applied", storageAvailable: false });
});

test("treats an unavailable probe identifier as unavailable browser persistence", () => {
  vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
    throw new Error("unavailable");
  });
  expect(canPersistMigrationDraft()).toBe(false);
});

test("blocks schema-valid source fields that the editor importer would silently drop", async () => {
  const result = proposal({ ...menu, open_actions: "close_menu" });
  expect((await applyMigrationProposal(result, "p")).status).toBe("blocked");
  expect(useAccountStore.getState().account.projects[0].menus).toHaveLength(0);
});
