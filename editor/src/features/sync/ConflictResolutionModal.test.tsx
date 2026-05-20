import { describe, expect, it, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ConflictResolutionModal } from "./ConflictResolutionModal";
import { useConflictsStore } from "@/state/conflictsStore";
import i18n from "@/i18n";

beforeAll(async () => {
  await i18n.changeLanguage("fr");
});

const mkConflict = (id: string, packId: string, overrides?: any) => ({
  id, packId,
  detectedAt: "2026-05-20T10:00:00Z",
  diskHash: "d", backendHashAtDetection: "b",
  fileCount: 4,
  diff: { addedOnDisk: ["a.yaml"], removedOnDisk: ["b.yaml"], modifiedOnDisk: ["c.yaml", "d.yaml"] },
  ...overrides,
});

describe("ConflictResolutionModal", () => {
  beforeEach(() => {
    useConflictsStore.setState({ conflicts: [] });
  });

  it("shows summary counts", () => {
    useConflictsStore.setState({ conflicts: [mkConflict("c1", "p1")] });
    render(<ConflictResolutionModal apiUrl="http://api" token="tok" onClose={vi.fn()} />);
    expect(screen.getByText(/p1/)).toBeTruthy();
    expect(screen.getByText(/1 ajouté/i)).toBeTruthy();
    expect(screen.getByText(/2 modifié/i)).toBeTruthy();
    expect(screen.getByText(/1 supprimé/i)).toBeTruthy();
  });

  it("shows empty-disk warning when fileCount is 0", () => {
    useConflictsStore.setState({ conflicts: [mkConflict("c1", "p1", { fileCount: 0 })] });
    render(<ConflictResolutionModal apiUrl="http://api" token="tok" onClose={vi.fn()} />);
    expect(screen.getByText(/vider ce pack/i)).toBeTruthy();
  });

  it("calls resolveConflict + removes from store on Keep editor", async () => {
    const original = global.fetch;
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ resolved: true, newHash: "h" }) });
    global.fetch = fetchMock as any;
    useConflictsStore.setState({ conflicts: [mkConflict("c1", "p1")] });

    render(<ConflictResolutionModal apiUrl="http://api" token="tok" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Garder l'éditeur/i }));

    await waitFor(() => {
      expect(useConflictsStore.getState().conflicts.length).toBe(0);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://api/api/editor-session/tok/conflicts/c1/resolve",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ choice: "editor" }),
      }),
    );
    global.fetch = original;
  });

  it("calls onClose when last conflict resolved", async () => {
    const original = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ resolved: true, newHash: "h" }) }) as any;
    useConflictsStore.setState({ conflicts: [mkConflict("c1", "p1")] });
    const onClose = vi.fn();
    render(<ConflictResolutionModal apiUrl="http://api" token="tok" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /Utiliser le serveur/i }));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    global.fetch = original;
  });
});
