import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TaskTimeline } from "./TaskTimeline";
import * as api from "@/lib/api/assistantTasks";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/api/assistantTasks", () => ({
  listAssistantTasks: vi.fn(),
  stopAssistantTask: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("explains the actual migration pause cause instead of a generic interruption", async () => {
  vi.mocked(api.listAssistantTasks).mockResolvedValue([{
    id: "paused", conversationId: "c", message: "continue", status: "blocked",
    events: [{ type: "migration_started", runId: "run" }, { type: "error", message: "provider_timeout" }],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }]);
  render(<TaskTimeline conversationId="c" refresh={0} onBusy={() => {}} onTranscriptOffset={() => {}} onApply={async () => {}} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("assistant.migration.errors.provider_timeout");
  expect(api.stopAssistantTask).not.toHaveBeenCalled();
});
it("recovers running activity on mount without starting work or applying proposals", async () => {
  const task = {
    id: "t1",
    conversationId: "c",
    message: "Migrate menus",
    status: "running" as const,
    events: [
      { type: "text", text: "Working" },
      { type: "menu_written", menu: { id: "shop" } },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  vi.mocked(api.listAssistantTasks).mockResolvedValue([task]);
  vi.mocked(api.stopAssistantTask).mockResolvedValue({ ...task, status: "cancelled" });
  const apply = vi.fn();
  const view = render(
    <TaskTimeline
      conversationId="c"
      refresh={0}
      onBusy={() => {}}
      onTranscriptOffset={() => {}}
      onApply={apply}
    />,
  );
  await screen.findByText("Working");
  expect(apply).not.toHaveBeenCalled();
  view.unmount();
  expect(api.stopAssistantTask).not.toHaveBeenCalled();
  render(
    <TaskTimeline
      conversationId="c"
      refresh={0}
      onBusy={() => {}}
      onTranscriptOffset={() => {}}
      onApply={apply}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "assistant.tasks.stop" }));
  await waitFor(() => expect(api.stopAssistantTask).toHaveBeenCalledWith("c", "t1"));
});

it("renders Markdown from streamed answer fragments", async () => {
  vi.mocked(api.listAssistantTasks).mockResolvedValue([
    {
      id: "markdown",
      conversationId: "c",
      message: "Explain",
      status: "completed",
      events: [
        { type: "text", text: "## Result\n\n**Bo" },
        { type: "text", text: "ld**\n\n- First\n- Second\n\n```yaml\nmenu: shop\n```" },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ]);
  render(
    <TaskTimeline
      conversationId="c"
      refresh={0}
      onBusy={() => {}}
      onTranscriptOffset={() => {}}
      onApply={async () => {}}
    />,
  );
  expect(await screen.findByRole("heading", { name: "Result" })).toBeVisible();
  expect(screen.getByText("Bold").tagName).toBe("STRONG");
  expect(screen.getByText("First").tagName).toBe("LI");
  expect(screen.getByText("menu: shop").tagName).toBe("CODE");
});
