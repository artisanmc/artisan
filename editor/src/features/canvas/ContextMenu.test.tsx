import type { ProjectId } from "@/domain/types";
import { useProjectsStore } from "@/state/projectsStore";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContextMenu } from "./ContextMenu";

const PID = "p1" as ProjectId;

const baseProps = {
  projectId: PID,
  onClose: vi.fn(),
  onCopy: vi.fn(),
  onPaste: vi.fn(),
  onPasteAt: vi.fn(),
  onDuplicate: vi.fn(),
  onDelete: vi.fn(),
  onMoveTo: vi.fn(),
  onOpenProjectSettings: vi.fn(),
};

const emptyTargetState = {
  open: true,
  x: 10,
  y: 10,
  target: { kind: "empty" as const, world: { x: 0, y: 0 } },
};

beforeEach(() => {
  useProjectsStore.setState({
    openProjects: { projectOrder: [PID], projects: [] },
  } as any);
});

describe("ContextMenu — canvas background", () => {
  /**
   * The edit panel only appears on selection; right-clicking the background is
   * the natural entry point to project settings, since it is precisely the
   * gesture that deselects.
   */
  it("offers the project settings", async () => {
    const user = userEvent.setup();
    const onOpenProjectSettings = vi.fn();
    render(
      <ContextMenu
        {...baseProps}
        state={emptyTargetState}
        onOpenProjectSettings={onOpenProjectSettings}
      />,
    );
    await user.click(screen.getByText(/Paramètres du projet|Project settings/i));
    expect(onOpenProjectSettings).toHaveBeenCalled();
  });

  /** In focus view, "create here" disappears — settings stay. */
  it("keeps them in focus view, without the 'create here' entries", () => {
    render(<ContextMenu {...baseProps} state={emptyTargetState} />);
    expect(screen.getByText(/Paramètres du projet|Project settings/i)).toBeInTheDocument();
    expect(screen.queryByText(/^(Nouveau|New)$/)).toBeNull();
  });

  /** "New" lists the creatable kinds and creates the picked one at the clicked point. */
  it("creates the picked kind at the clicked point", async () => {
    const user = userEvent.setup();
    const onCreateAt = vi.fn();
    render(
      <ContextMenu
        {...baseProps}
        state={{ ...emptyTargetState, target: { kind: "empty", world: { x: 120, y: 80 } } }}
        createKinds={[
          { kind: "menu", label: "Menu" },
          { kind: "trigger", label: "Triggers" },
        ]}
        onCreateAt={onCreateAt}
      />,
    );
    screen.getByText(/^(Nouveau|New)$/).focus();
    await user.keyboard("{ArrowRight}");
    await user.click(await screen.findByText("Triggers"));
    expect(onCreateAt).toHaveBeenCalledWith("trigger", { x: 120, y: 80 });
  });
});

describe("ContextMenu — background click with a selection", () => {
  it("offers New next to the selection's actions", () => {
    render(
      <ContextMenu
        {...baseProps}
        state={{
          open: true,
          x: 10,
          y: 10,
          target: { kind: "entity", selectedIds: ["a"], world: { x: 0, y: 0 } },
        }}
        createKinds={[{ kind: "menu", label: "Menu" }]}
        onCreateAt={vi.fn()}
      />,
    );
    expect(screen.getByText(/^(Nouveau|New)$/)).toBeInTheDocument();
    expect(screen.getByText("Copy")).toBeInTheDocument();
  });

  it("leaves New out on a right-click on a Document", () => {
    render(
      <ContextMenu
        {...baseProps}
        state={{ open: true, x: 10, y: 10, target: { kind: "entity", selectedIds: ["a"] } }}
        createKinds={[{ kind: "menu", label: "Menu" }]}
        onCreateAt={vi.fn()}
      />,
    );
    expect(screen.queryByText(/^(Nouveau|New)$/)).toBeNull();
  });
});
