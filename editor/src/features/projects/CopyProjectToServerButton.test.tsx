import i18n from "@/i18n";
import { clearCopyRecovery } from "@/lib/copyRecovery";
import { useAuthStore } from "@/state/authStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { useProjectRuntimeStore } from "@/state/projectRuntimeStore";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CopyProjectToServerButton } from "./CopyProjectToServerButton";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
beforeEach(async () => {
  await i18n.changeLanguage("en");
  clearCopyRecovery();
  navigate.mockReset();
  useAuthStore.setState({ currentUser: { id: "owner" } } as never);
  useProjectDraftStore.setState({ drafts: {}, pendingRenames: {} });
  useProjectRuntimeStore.getState().set({
    projectId: "source",
    networkId: "network",
    serverId: null,
    minecraftVersion: "1.21.4",
    capabilities: {
      canRename: true,
      canCopyToServer: true,
      liveData: false,
      captureInGame: false,
      preview: true,
    },
    connection: { available: true },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
test("capability hides the copy action for server and older metadata", () => {
  useProjectRuntimeStore.getState().set(null);
  render(<CopyProjectToServerButton projectId="source" />);
  expect(screen.queryByRole("button")).toBeNull();
});
test.each(["text", "binary"])(
  "offers explicit saved/apply choices for %s edits and opens the independent immutable server project",
  async (kind) => {
    useProjectDraftStore.getState().save("source", {
      baseline: {},
      tree: kind === "text" ? { "manifest.yaml": "name: Edit" } : {},
      initialTree: {},
      binaryBaseline: {},
      binaryTree: { "a.png": { hash: "new", size: 2 } },
      at: 1,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        if (String(url).endsWith("copy-targets"))
          return new Response(
            JSON.stringify({
              sourceRevision: "saved",
              targets: [
                {
                  serverKeyId: "server-id",
                  networkId: "target-network",
                  name: "Survival",
                  compatible: true,
                  reason: null,
                  folderName: "demo_2",
                },
              ],
            }),
          );
        const input = JSON.parse(init.body);
        return new Response(
          JSON.stringify({
            ...input,
            targetNetworkId: "target-network",
            state: "completed",
            projectId: "immutable-copy",
            error: null,
          }),
        );
      }),
    );
    render(<CopyProjectToServerButton projectId="source" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy to Minecraft" }));
    expect(await screen.findByLabelText("Apply my current draft, then copy")).toBeInTheDocument();
    expect(screen.getByLabelText("Copy the saved version")).toBeChecked();
    await waitFor(() => expect(screen.getByLabelText("Project folder")).toHaveValue("demo_2"));
    fireEvent.click(screen.getByRole("button", { name: "Copy saved version" }));
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: "/networks/$networkId/servers/$serverId/projects/$projectId",
        params: { networkId: "target-network", serverId: "server-id", projectId: "immutable-copy" },
      }),
    );
    expect(useProjectDraftStore.getState().get("source")?.binaryTree?.["a.png"]?.hash).toBe("new");
  },
);
test("resource pack preparation keeps the copy visible and retries the same operation before opening", async () => {
  let operation: Record<string, unknown> = {};
  const fetcher = vi.fn(async (url, init) => {
    if (String(url).endsWith("copy-targets"))
      return new Response(
        JSON.stringify({
          sourceRevision: "saved",
          targets: [
            {
              serverKeyId: "server-id",
              networkId: "target-network",
              name: "Survival",
              compatible: true,
              folderName: "demo_2",
            },
          ],
        }),
      );
    if (String(url).endsWith("/resume"))
      return new Response(JSON.stringify({ ...operation, error: null }));
    if (init?.body)
      operation = {
        ...JSON.parse(init.body),
        targetNetworkId: "target-network",
        state: "completed",
        projectId: "immutable-copy",
        error: "resource_pack_pending",
      };
    return new Response(JSON.stringify(operation));
  });
  vi.stubGlobal("fetch", fetcher);
  render(<CopyProjectToServerButton projectId="source" />);
  fireEvent.click(screen.getByRole("button", { name: "Copy to Minecraft" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Copy saved version" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Copy saved version" }));
  expect(await screen.findByText(/resource pack is not ready/)).toBeInTheDocument();
  expect(navigate).not.toHaveBeenCalled();
  expect(screen.queryByText("The independent server project is ready.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry resource pack" }));
  await waitFor(() => expect(navigate).toHaveBeenCalled());
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/copies"))).toHaveLength(1);
  expect(
    fetcher.mock.calls.some(([url]) =>
      String(url).endsWith(`/copies/${operation.operationId}/resume`),
    ),
  ).toBe(true);
});
test("offline and incompatible destinations cannot be submitted", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            sourceRevision: "saved",
            targets: [
              {
                serverKeyId: "old",
                name: "Old server",
                compatible: false,
                reason: "incompatible_version",
                folderName: "demo",
              },
            ],
          }),
        ),
    ),
  );
  render(<CopyProjectToServerButton projectId="source" />);
  fireEvent.click(screen.getByRole("button", { name: "Copy to Minecraft" }));
  expect(await screen.findByText(/No compatible server is connected/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Copy saved version" })).toBeDisabled();
  expect(screen.getByRole("option", { name: /Old server/ })).toBeDisabled();
});
test("a source revision rejection returns to the form and reopening chooses a new revision and operation", async () => {
  const inputs: { operationId: string; sourceRevision: string }[] = [];
  let revision = "old";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, init) => {
      if (String(url).endsWith("copy-targets"))
        return new Response(
          JSON.stringify({
            sourceRevision: revision,
            targets: [
              {
                serverKeyId: "server-id",
                networkId: "target-network",
                name: "Survival",
                compatible: true,
                reason: null,
                folderName: "demo_2",
              },
            ],
          }),
        );
      const input = JSON.parse(init.body);
      inputs.push(input);
      if (input.sourceRevision === "old")
        return new Response(JSON.stringify({ error: "source_revision_changed" }), { status: 409 });
      return new Response(
        JSON.stringify({
          ...input,
          targetNetworkId: "target-network",
          state: "completed",
          projectId: "copy",
          error: null,
        }),
      );
    }),
  );
  render(<CopyProjectToServerButton projectId="source" />);
  fireEvent.click(screen.getByRole("button", { name: "Copy to Minecraft" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Copy saved version" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Copy saved version" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("The saved project changed");
  expect(screen.queryByRole("button", { name: "Check and resume" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  revision = "new";
  fireEvent.click(screen.getByRole("button", { name: "Copy to Minecraft" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Copy saved version" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Copy saved version" }));
  await waitFor(() => expect(navigate).toHaveBeenCalled());
  expect(inputs.map((input) => input.sourceRevision)).toEqual(["old", "new"]);
  expect(inputs[0]?.operationId).not.toBe(inputs[1]?.operationId);
});
