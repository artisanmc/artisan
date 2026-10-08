import { renameProject } from "@/lib/api/projectIdentity";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import i18n from "i18next";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RenameProjectButton } from "./RenameProjectButton";
import { diskProjectsToSummaries } from "./projectGroups";
vi.mock("@/lib/api/projectIdentity", () => ({ renameProject: vi.fn() }));
beforeEach(async () => {
  sessionStorage.clear();
  vi.mocked(renameProject).mockReset();
  await i18n.changeLanguage("en");
});
afterEach(cleanup);

it("restores a pending server operation from a refreshed listing without browser storage", async () => {
  const operation = { operationId: "persisted-server-operation", targetId: "new" };
  const response = {
    project_ids: ["other"],
    projects: [
      {
        id: "internal",
        name: "old",
        externalId: "old",
        hash: "",
        networkId: "network",
        serverKeyId: "server",
        capabilities: { canRename: false },
        pendingRename: { ...operation, status: "pending" as const },
      },
    ],
  };
  const summaries = diskProjectsToSummaries(
    "network",
    "server",
    response.project_ids,
    response.projects,
  );
  const pending = summaries.find((project) => project.id === "internal");
  expect(pending).toBeDefined();
  if (!pending) return;
  vi.mocked(renameProject).mockResolvedValue({
    status: "pending",
    operationId: operation.operationId,
  });
  render(<RenameProjectButton project={pending} onRenamed={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect(screen.getByLabelText("Project folder")).toHaveValue("new");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(renameProject).toHaveBeenCalledWith("internal", operation));
});

it("does not expose rename when the project capability disallows it", () => {
  render(
    <RenameProjectButton
      project={{ id: "addon", externalId: "boutique_addon", capabilities: { canRename: false } }}
      onRenamed={vi.fn()}
    />,
  );
  expect(screen.queryByRole("button")).toBeNull();
});

it("lets the user choose another target after a terminal reserved-name rejection", async () => {
  vi.mocked(renameProject).mockRejectedValue(
    Object.assign(new Error("destination_reserved"), { terminal: true }),
  );
  render(
    <RenameProjectButton
      project={{ id: "internal", externalId: "old", capabilities: { canRename: true } }}
      onRenamed={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  fireEvent.change(screen.getByLabelText("Project folder"), { target: { value: "reserved" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.getByLabelText("Project folder")).not.toBeDisabled());
  expect(sessionStorage.getItem("artisan.rename.internal")).toBeNull();
  expect(
    screen.getByText("That name is reserved by an earlier rename. Choose another name."),
  ).toBeInTheDocument();
});

it("keeps a persisted pending operation visible when the server capability becomes unavailable", () => {
  sessionStorage.setItem(
    "artisan.rename.internal",
    JSON.stringify({ operationId: "pending", targetId: "new" }),
  );
  render(
    <RenameProjectButton
      project={{ id: "internal", externalId: "old", capabilities: { canRename: false } }}
      onRenamed={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
});

it("retries a pending rename with the original operation after remount", async () => {
  vi.mocked(renameProject).mockImplementation(async (_id, operation) => ({
    status: "pending",
    operationId: operation.operationId,
  }));
  const project = { id: "internal", externalId: "old", capabilities: { canRename: true } };
  const onRenamed = vi.fn();
  const first = render(<RenameProjectButton project={project} onRenamed={onRenamed} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  fireEvent.change(screen.getByLabelText("Project folder"), { target: { value: "new_folder" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("button", { name: "Retry" });
  const operation = vi.mocked(renameProject).mock.calls[0]![1];
  first.unmount();
  vi.mocked(renameProject).mockResolvedValue({
    status: "complete",
    operationId: operation.operationId,
    projectId: "internal",
    diskId: "new_folder",
  });
  render(<RenameProjectButton project={project} onRenamed={onRenamed} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(onRenamed).toHaveBeenCalledWith("new_folder"));
  expect(renameProject).toHaveBeenLastCalledWith("internal", operation);
});
