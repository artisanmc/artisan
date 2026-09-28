import { getEditorAccess } from "@/lib/api/projectFiles";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EditorAccessNotice } from "./EditorAccessNotice";

vi.mock("@/lib/api/projectFiles", () => ({ getEditorAccess: vi.fn() }));
describe("effective resource quota", () => {
  it("renders unlimited custom rights independently from proUntil", async () => {
    vi.mocked(getEditorAccess).mockResolvedValue({
      enabled: true,
      quota: null,
      proUntil: null,
      inventoryAvailable: true,
      count: 300,
      reason: null,
      projectOrigin: "personal",
    });
    render(<EditorAccessNotice projectId="project" />);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "300 ressources personnelles · illimité",
    );
  });
  it("uses the actual custom quota without labelling it Free or Pro", async () => {
    vi.mocked(getEditorAccess).mockResolvedValue({
      enabled: true,
      quota: 42,
      proUntil: "2999-01-01",
      inventoryAvailable: true,
      count: 43,
      reason: "free_quota_exceeded",
      projectOrigin: "personal",
    });
    render(<EditorAccessNotice projectId="project" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("43 / 42 ressources personnelles");
    expect(screen.queryByText(/pro actif|gratuit/i)).not.toBeInTheDocument();
  });
});
