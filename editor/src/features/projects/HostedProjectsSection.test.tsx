import * as api from "@/lib/api/hostedProjects";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { HostedProjectsSection } from "./HostedProjectsSection";
const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  Link: ({ children }: { children: React.ReactNode }) => <a href="/project">{children}</a>,
}));
vi.mock("@/lib/api/hostedProjects", async (original) => ({
  ...(await original<typeof api>()),
  listHostedProjects: vi.fn(async () => []),
  hostedTemplates: vi.fn(async () => ({
    templates: [{ id: "vanilla" }],
    minecraftVersions: ["1.21.4"],
  })),
  createHostedProject: vi.fn(),
}));
beforeEach(() => {
  vi.clearAllMocks();
});
it("creates from an empty Network without choosing or fabricating a server", async () => {
  vi.mocked(api.createHostedProject).mockResolvedValue({ id: "p", name: "Demo" } as never);
  render(<HostedProjectsSection networkId="network" />);
  fireEvent.click(screen.getByRole("button", { name: "Create without a server" }));
  fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "Demo" } });
  fireEvent.change(screen.getAllByRole("textbox")[1]!, { target: { value: "demo" } });
  fireEvent.submit(screen.getByLabelText("Project name").closest("form")!);
  await waitFor(() =>
    expect(navigate).toHaveBeenCalledWith({
      to: "/networks/$networkId/projects/$projectId",
      params: { networkId: "network", projectId: "p" },
    }),
  );
  expect(api.createHostedProject).toHaveBeenCalledWith("network", {
    operationId: expect.any(String),
    name: "Demo",
    folderName: "demo",
    minecraftVersion: "1.21.4",
    templateId: "vanilla",
  });
});
