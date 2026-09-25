import { clearImportRecovery } from "@/lib/importRecovery";
import { useAuthStore } from "@/state/authStore";
import JSZip from "jszip";
import { beforeEach, expect, it, vi } from "vitest";
import { importHostedProject } from "./importHostedProject";
const write = vi.fn();
const read = vi.fn();
const createHostedProject = vi.fn();
const listHostedProjects = vi.fn();
vi.mock("@/lib/api/hostedProjects", () => ({
  createHostedProject: (...args: unknown[]) => createHostedProject(...args),
  listHostedProjects: (...args: unknown[]) => listHostedProjects(...args),
}));
vi.mock("@/lib/projectClient", () => ({
  projectClient: () => ({
    read,
    write,
  }),
}));
beforeEach(() => {
  useAuthStore.setState({ currentUser: { id: "owner" } } as never);
  clearImportRecovery();
  write.mockReset();
  createHostedProject.mockReset().mockResolvedValue({ id: "immutable" });
  listHostedProjects.mockReset().mockResolvedValue([]);
  read.mockReset().mockResolvedValue({ ok: true, files: { "manifest.yaml": "old" }, binaries: [] });
  sessionStorage.clear();
});
it("does not restore private recovery bytes or publish after logout during the baseline read", async () => {
  let resolve!: (value: unknown) => void;
  let ready!: () => void;
  const started = new Promise<void>((done) => {
    ready = done;
  });
  read.mockImplementationOnce(() => {
    ready();
    return new Promise((done) => {
      resolve = done;
    });
  });
  const zip = new JSZip();
  zip.file("demo/manifest.yaml", "name: Secret");
  zip.file("demo/assets/a.png", new Uint8Array([0, 255]));
  const request = importHostedProject(
    await zip.generateAsync({ type: "blob" }),
    "network",
    "1.21.4",
    "owner",
  );
  await started;
  useAuthStore.setState({ currentUser: null });
  useAuthStore.setState({ currentUser: { id: "owner" } } as never);
  resolve({ ok: true, files: {}, binaries: [] });
  await expect(request).rejects.toThrow("session_changed");
  expect(write).not.toHaveBeenCalled();
  expect(
    Object.keys(sessionStorage).filter((key) => key.startsWith("artisan:import-recovery:")),
  ).toEqual([]);
});
it("imports text and exact image/font bytes in one retryable transaction", async () => {
  const zip = new JSZip();
  zip.file("demo/manifest.yaml", "schema: artisan-project/v1\nname: Demo\n");
  zip.file("demo/assets/a.png", new Uint8Array([137, 80, 0, 255]));
  zip.file("demo/fonts/a.ttf", new Uint8Array([0, 1, 2, 255]));
  zip.file("demo/.artisan/drafts/private.json", "secret");
  const file = await zip.generateAsync({ type: "blob" });
  write.mockRejectedValueOnce(new Error("timeout")).mockResolvedValue({ ok: true });
  await expect(importHostedProject(file, "network", "1.21.4", "owner")).rejects.toThrow("timeout");
  expect(await importHostedProject(file, "network", "1.21.4", "owner")).toEqual({
    newId: "immutable",
    urlId: "demo",
    name: "Demo",
  });
  expect(write.mock.calls[0]).toEqual(write.mock.calls[1]);
  expect(write.mock.calls[0]![0].binaries).toEqual([
    { path: "assets/a.png", content_base64: "iVAA/w==", base_hash: null },
    { path: "fonts/a.ttf", content_base64: "AAEC/w==", base_hash: null },
  ]);
  expect(JSON.stringify(write.mock.calls[0])).not.toContain("secret");
});

it("sends an operation id the backend accepts", async () => {
  const zip = new JSZip();
  zip.file("demo/manifest.yaml", "name: Demo\n");
  write.mockResolvedValue({ ok: true });
  await importHostedProject(
    await zip.generateAsync({ type: "blob" }),
    "network",
    "1.21.4",
    "owner",
  );
  expect(write.mock.calls[0]![0].operationId).toMatch(/^[a-zA-Z0-9_-]{1,128}$/);
});

it("reports a folder already taken instead of a generic failure", async () => {
  const zip = new JSZip();
  zip.file("main/manifest.yaml", "name: Main\n");
  createHostedProject.mockRejectedValue(new Error("destination_exists"));
  await expect(
    importHostedProject(await zip.generateAsync({ type: "blob" }), "network", "1.21.4", "owner"),
  ).rejects.toThrow("destination_exists");
  expect(write).not.toHaveBeenCalled();
});

it("overwrites the hosted project of the same folder exactly, when asked", async () => {
  const zip = new JSZip();
  zip.file("main/manifest.yaml", "name: Main\n");
  zip.file("main/menus/new.yaml", "id: new\n");
  createHostedProject.mockRejectedValue(new Error("destination_exists"));
  listHostedProjects.mockResolvedValue([
    { id: "other", externalId: "else" },
    { id: "existing", externalId: "main" },
  ]);
  read.mockResolvedValue({
    ok: true,
    files: { "manifest.yaml": "old", "menus/old.yaml": "id: old\n" },
    binaries: [{ path: "assets/old.png", hash: "h" }],
  });
  write.mockResolvedValue({ ok: true });
  const result = await importHostedProject(
    await zip.generateAsync({ type: "blob" }),
    "network",
    "1.21.4",
    "owner",
    undefined,
    { overwrite: true },
  );
  expect(result).toMatchObject({ newId: "existing", urlId: "main" });
  const batch = write.mock.calls[0]![0];
  expect(batch.files.map((f: { path: string }) => f.path)).toEqual([
    "manifest.yaml",
    "menus/new.yaml",
  ]);
  expect(batch.deletes.map((d: { path: string }) => d.path)).toEqual(["menus/old.yaml"]);
  expect(batch.binaries).toEqual([
    { path: "assets/old.png", content_base64: null, base_hash: "h" },
  ]);
});
