import { describe, expect, it, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConflictBanner } from "./ConflictBanner";
import { useConflictsStore } from "@/state/conflictsStore";
import i18n from "@/i18n";

beforeAll(async () => {
  await i18n.changeLanguage("fr");
});

describe("ConflictBanner", () => {
  beforeEach(() => {
    useConflictsStore.setState({ conflicts: [] });
  });

  it("renders nothing when store is empty", () => {
    const { container } = render(<ConflictBanner onSeeDetails={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders count when store has conflicts", () => {
    useConflictsStore.setState({
      conflicts: [
        { id: "c1", packId: "p1" } as any,
        { id: "c2", packId: "p2" } as any,
      ],
    });
    render(<ConflictBanner onSeeDetails={vi.fn()} />);
    expect(screen.getByText(/2 conflits/i)).toBeTruthy();
  });

  it("calls onSeeDetails when button is clicked", () => {
    useConflictsStore.setState({ conflicts: [{ id: "c1", packId: "p1" } as any] });
    const onSeeDetails = vi.fn();
    render(<ConflictBanner onSeeDetails={onSeeDetails} />);
    fireEvent.click(screen.getByRole("button", { name: /détails/i }));
    expect(onSeeDetails).toHaveBeenCalledTimes(1);
  });
});
