import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DivergenceBanner } from "./DivergenceBanner";
import { useDivergenceStore } from "@/state/divergenceStore";
import * as api from "@/lib/api/userProjects";

vi.mock("@/lib/api/userProjects", () => ({ resolveDivergence: vi.fn().mockResolvedValue(undefined) }));

const PID = "p_banner";

function seedDivergence() {
  useDivergenceStore.getState().set(PID, {
    disk_hash: "h_disk",
    at: "2026-07-24T00:00:00.000Z",
    files: [
      { path: "menus/a.yaml", disk: "id: a\ntitle: DISK\n", web: "id: a\ntitle: WEB\n" },
      { path: "menus/disk_only.yaml", disk: "id: d\n", web: null },
    ],
  });
}

describe("DivergenceBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDivergenceStore.setState({ byProject: {} });
    // window.location.reload is called after a successful resolve — stub it.
    Object.defineProperty(window, "location", {
      value: { ...window.location, reload: vi.fn() },
      writable: true,
    });
  });

  it("renders nothing without a pending divergence", () => {
    const { container } = render(<DivergenceBanner projectId={PID} />);
    expect(container.firstChild).toBeNull();
  });

  it("lists divergent files and resolves with per-file choices (default disk)", async () => {
    seedDivergence();
    render(<DivergenceBanner projectId={PID} />);
    expect(screen.getByText("menus/a.yaml")).toBeInTheDocument();
    expect(screen.getByText("menus/disk_only.yaml")).toBeInTheDocument();

    // Flip menus/a.yaml to "web"; leave disk_only on the disk default.
    const webButtons = screen.getAllByRole("button", { name: /web version|version web/i });
    fireEvent.click(webButtons[0]!);

    fireEvent.click(screen.getByRole("button", { name: /^(Resolve|Résoudre)$/ }));
    await vi.waitFor(() => expect(api.resolveDivergence).toHaveBeenCalledTimes(1));
    expect(api.resolveDivergence).toHaveBeenCalledWith(PID, {
      "menus/a.yaml": "web",
      "menus/disk_only.yaml": "disk",
    });
    // Store cleared after success.
    expect(useDivergenceStore.getState().byProject[PID]).toBeUndefined();
  });

  it("'keep all web' flips every choice", async () => {
    seedDivergence();
    render(<DivergenceBanner projectId={PID} />);
    fireEvent.click(screen.getByRole("button", { name: /all web|Tout garder côté web/i }));
    fireEvent.click(screen.getByRole("button", { name: /^(Resolve|Résoudre)$/ }));
    await vi.waitFor(() => expect(api.resolveDivergence).toHaveBeenCalledTimes(1));
    expect(api.resolveDivergence).toHaveBeenCalledWith(PID, {
      "menus/a.yaml": "web",
      "menus/disk_only.yaml": "web",
    });
  });
});
