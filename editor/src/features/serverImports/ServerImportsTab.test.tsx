import { ApiError } from "@/lib/api/client";
import type { ImportListing, ImportReport, ImportRun, ImportSource } from "@/lib/api/imports";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import i18n from "i18next";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ServerImportsTab, canImport, rolledBack } from "./ServerImportsTab";

const api = vi.hoisted(() => ({
  listImports: vi.fn(),
  startImport: vi.fn(),
  startImportRollback: vi.fn(),
}));
vi.mock("@/lib/api/imports", () => api);

const source = (over: Partial<ImportSource> = {}): ImportSource => ({
  id: "auctions:zauctionhouse",
  label: "zAuctionHouse v4",
  module: "auctions",
  readsFile: false,
  conflictRunning: null,
  ...over,
});

const report = (over: Partial<ImportReport> = {}): ImportReport => ({
  failed: null,
  dryRun: true,
  counts: [{ kind: "listings", label: "Active listings", count: 2 }],
  alreadyImported: 0,
  rejected: [],
  blockers: [],
  notes: [],
  ...over,
});

const run = (over: Partial<ImportRun> = {}): ImportRun => ({
  batch: "b1",
  source: "auctions:zauctionhouse",
  module: "auctions",
  action: "plan",
  applied: false,
  actor: "Iban",
  at: Date.UTC(2026, 10, 18, 10, 0),
  target: null,
  report: report(),
  ...over,
});

const listing = (over: Partial<ImportListing> = {}): ImportListing => ({
  sources: [source()],
  files: [],
  active: [],
  runs: [],
  ...over,
});

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

describe("server imports tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs a dry run, shows its report, then offers the import", async () => {
    api.listImports.mockResolvedValueOnce(listing());
    api.startImport.mockResolvedValueOnce("b1");
    const planned = run({
      report: report({
        alreadyImported: 3,
        rejected: [{ sourceId: "7", code: "active_bid", message: "has a bid" }],
        notes: ["check the prices"],
      }),
    });
    api.listImports.mockResolvedValue(listing({ runs: [planned] }));
    render(<ServerImportsTab serverId="s1" />);

    const card = await screen.findByTestId("source-auctions:zauctionhouse");
    expect(within(card).queryByRole("button", { name: "Import" })).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Dry run" }));

    await within(card).findByText("Dry run: nothing was written.");
    expect(api.startImport).toHaveBeenCalledWith("s1", "auctions:zauctionhouse", {
      file: undefined,
      confirm: false,
      lang: "en",
    });
    expect(within(card).getByText("Active listings")).toBeTruthy();
    expect(within(card).getByText("Already imported, skipped: 3")).toBeTruthy();
    expect(within(card).getByText("1 record left aside")).toBeTruthy();
    expect(within(card).getByText("has a bid")).toBeTruthy();

    api.startImport.mockResolvedValueOnce("b2");
    api.listImports.mockResolvedValue(
      listing({
        runs: [
          run({ batch: "b2", action: "apply", applied: true, report: report({ dryRun: false }) }),
          planned,
        ],
      }),
    );
    fireEvent.click(within(card).getByRole("button", { name: "Import" }));
    await within(card).findByText("Imported. Batch b2.");
    expect(api.startImport).toHaveBeenLastCalledWith("s1", "auctions:zauctionhouse", {
      file: undefined,
      confirm: true,
      lang: "en",
    });
  });

  it("does not offer the import after a blocked or empty dry run, nor without a yes", async () => {
    api.listImports.mockResolvedValueOnce(listing());
    api.startImport.mockResolvedValue("b1");
    api.listImports.mockResolvedValue(
      listing({ runs: [run({ report: report({ blockers: ["unknown currency: gems"] }) })] }),
    );
    render(<ServerImportsTab serverId="s1" />);
    const card = await screen.findByTestId("source-auctions:zauctionhouse");
    fireEvent.click(within(card).getByRole("button", { name: "Dry run" }));
    await within(card).findByText("unknown currency: gems");
    expect(within(card).queryByRole("button", { name: "Import" })).toBeNull();

    expect(canImport(run({ report: report({ counts: [] }) }))).toBe(false);
    expect(canImport(run({ report: report({ failed: "boom" }) }))).toBe(false);
    expect(canImport(run({ action: "apply" }))).toBe(false);
    expect(canImport(run())).toBe(true);
  });

  it("keeps the write off while the source plugin runs, and says why", async () => {
    api.listImports.mockResolvedValueOnce(
      listing({ sources: [source({ conflictRunning: "zAuctionHouse" })] }),
    );
    api.startImport.mockResolvedValue("b1");
    api.listImports.mockResolvedValue(
      listing({ sources: [source({ conflictRunning: "zAuctionHouse" })], runs: [run()] }),
    );
    render(<ServerImportsTab serverId="s1" />);
    const card = await screen.findByTestId("source-auctions:zauctionhouse");
    expect(within(card).getByText(/zAuctionHouse is running on the server/)).toBeTruthy();
    fireEvent.click(within(card).getByRole("button", { name: "Dry run" }));
    const write = (await within(card).findByRole("button", {
      name: "Import",
    })) as HTMLButtonElement;
    expect(write.disabled).toBe(true);
  });

  it("asks for a file when the source reads one", async () => {
    api.listImports.mockResolvedValue(
      listing({
        sources: [source({ id: "auctions:json", label: "Auctions file", readsFile: true })],
        files: ["listings.json"],
      }),
    );
    api.startImport.mockResolvedValue("b1");
    render(<ServerImportsTab serverId="s1" />);
    const card = await screen.findByTestId("source-auctions:json");
    const dry = within(card).getByRole("button", { name: "Dry run" }) as HTMLButtonElement;
    expect(dry.disabled).toBe(true);
    fireEvent.change(within(card).getByRole("combobox"), { target: { value: "listings.json" } });
    expect(dry.disabled).toBe(false);
    fireEvent.click(dry);
    await waitFor(() =>
      expect(api.startImport).toHaveBeenCalledWith("s1", "auctions:json", {
        file: "listings.json",
        confirm: false,
        lang: "en",
      }),
    );
  });

  it("undoes an import from the history: a dry run first, then the rollback", async () => {
    const applied = run({
      batch: "b2",
      action: "apply",
      applied: true,
      report: report({ dryRun: false }),
    });
    api.listImports.mockResolvedValueOnce(listing({ runs: [applied] }));
    api.startImportRollback.mockResolvedValueOnce("r1");
    const dry = run({
      batch: "r1",
      action: "rollback",
      target: "b2",
      report: report({
        counts: [{ kind: "records", label: "records undone", count: 2 }],
        rejected: [{ sourceId: "9", code: "changed_since", message: "bought since" }],
      }),
    });
    api.listImports.mockResolvedValue(listing({ runs: [dry, applied] }));
    render(<ServerImportsTab serverId="s1" />);

    const row = await screen.findByTestId("run-b2");
    fireEvent.click(within(row).getByRole("button", { name: "Undo…" }));
    await within(row).findByText("Dry run of the rollback: nothing was removed.");
    expect(api.startImportRollback).toHaveBeenCalledWith("s1", "b2", {
      confirm: false,
      lang: "en",
    });
    expect(within(row).getByText("1 record kept")).toBeTruthy();

    api.startImportRollback.mockResolvedValueOnce("r2");
    const done = run({
      batch: "r2",
      action: "rollback",
      applied: true,
      target: "b2",
      report: report({
        dryRun: false,
        counts: [{ kind: "records", label: "records undone", count: 2 }],
      }),
    });
    api.listImports.mockResolvedValue(listing({ runs: [done, dry, applied] }));
    fireEvent.click(within(row).getByRole("button", { name: "Undo this import" }));
    await within(row).findByText("Rollback done. What players changed since the import was kept.");
    expect(api.startImportRollback).toHaveBeenLastCalledWith("s1", "b2", {
      confirm: true,
      lang: "en",
    });
    expect(within(row).getByText("Undone")).toBeTruthy();
    expect(within(row).queryByRole("button", { name: "Undo…" })).toBeNull();
    expect(rolledBack([done, dry, applied])).toEqual(new Set(["b2"]));
  });

  it("says why the server refused, and what a failed run left", async () => {
    api.listImports.mockResolvedValue(
      listing({
        runs: [
          run({
            batch: "b3",
            action: "apply",
            applied: true,
            report: report({ failed: "connection lost", counts: [] }),
          }),
        ],
      }),
    );
    api.startImport.mockRejectedValue(new ApiError("busy", 409, null, "auctions"));
    render(<ServerImportsTab serverId="s1" />);
    const card = await screen.findByTestId("source-auctions:zauctionhouse");
    fireEvent.click(within(card).getByRole("button", { name: "Dry run" }));
    await within(card).findByText("Another import of this module is already running.");

    const row = screen.getByTestId("run-b3");
    expect(within(row).getByText("Failed")).toBeTruthy();
    expect(within(row).getByText("The run failed: connection lost")).toBeTruthy();
    // What it wrote before stopping can still be undone.
    expect(within(row).getByRole("button", { name: "Undo…" })).toBeTruthy();
  });

  it("offers no undo for an import that wrote nothing", async () => {
    api.listImports.mockResolvedValue(
      listing({
        runs: [
          run({
            batch: "b4",
            action: "apply",
            applied: true,
            report: report({ dryRun: false, counts: [], alreadyImported: 2 }),
          }),
        ],
      }),
    );
    render(<ServerImportsTab serverId="s1" />);
    const row = await screen.findByTestId("run-b4");
    expect(within(row).getByText("Nothing written")).toBeTruthy();
    expect(within(row).queryByRole("button", { name: "Undo…" })).toBeNull();
  });

  it("says so when no module imports anything, or the server cannot", async () => {
    api.listImports.mockResolvedValueOnce(listing({ sources: [] }));
    const { unmount } = render(<ServerImportsTab serverId="s1" />);
    await screen.findByText("None of this server's modules imports another plugin's data.");
    unmount();

    api.listImports.mockRejectedValue(new ApiError("plugin_update_required", 501));
    render(<ServerImportsTab serverId="s1" />);
    await screen.findByText("Update the server's Artisan plugin to import from the editor.");
  });
});
