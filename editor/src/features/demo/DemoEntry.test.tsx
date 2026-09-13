import { render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { DemoEntry } from "./DemoWorkspace";
const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useParams: () => ({ projectId: "demo" }),
}));
vi.mock("@/features/project/ProjectWorkspace", () => ({
  ProjectCanvasPage: () => <div>Shared canvas</div>,
}));
vi.mock("./demoLifecycle", () => ({
  bootstrapDemo: vi.fn(async () => ({
    projectId: "demo",
    principal: { kind: "guest", id: "guest" },
    csrfToken: "csrf",
    expiresAt: "2099-01-01",
  })),
  getPendingDemoClaim: () => null,
}));
test("demo entry opens the shared project without an account", async () => {
  render(<DemoEntry />);
  expect(screen.getByRole("status")).toBeTruthy();
  await waitFor(() =>
    expect(navigate).toHaveBeenCalledWith({
      to: "/demo/projects/$projectId",
      params: { projectId: "demo" },
      replace: true,
    }),
  );
});
