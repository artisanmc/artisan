import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
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
  useAccountStore.setState({
    account: { id: "a" as any, projectOrder: [PID], projects: [] },
  } as any);
});

describe("ContextMenu — fond du canvas", () => {
  /**
   * The edit panel only appears on selection; right-clicking the background is
   * the natural entry point to project settings, since it is precisely the
   * gesture that deselects.
   */
  it("propose les paramètres du projet", async () => {
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
  it("les garde en vue focus, sans les entrées « créer ici »", () => {
    render(<ContextMenu {...baseProps} state={emptyTargetState} />);
    expect(screen.getByText(/Paramètres du projet|Project settings/i)).toBeInTheDocument();
    expect(screen.queryByText(/Nouveau menu ici|New menu here/i)).toBeNull();
  });
});
