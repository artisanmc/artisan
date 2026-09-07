import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NewProjectModal } from "./NewProjectModal";

describe("NewProjectModal", () => {
  it("ignores Enter for an empty name and does not submit when cancelling", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <NewProjectModal
        open
        onOpenChange={onOpenChange}
        serverLabel="Survival"
        onCreate={onCreate}
      />,
    );
    await user.type(screen.getAllByRole("textbox")[0]!, "   {Enter}");
    expect(onCreate).not.toHaveBeenCalled();
    await user.type(screen.getAllByRole("textbox")[0]!, "Shop");
    await user.click(screen.getByRole("button", { name: /cancel|annuler/i }));
    expect(onCreate).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("does not create duplicates while a request is pending", async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    const onCreate = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const onOpenChange = vi.fn();
    render(
      <NewProjectModal
        open
        onOpenChange={onOpenChange}
        serverLabel="Survival"
        onCreate={onCreate}
      />,
    );
    await user.type(screen.getAllByRole("textbox")[0]!, "Shop{Enter}{Enter}");
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it.each([0, 1])("creates once when Enter is pressed in field %i", async (field) => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <NewProjectModal
        open
        onOpenChange={onOpenChange}
        serverLabel="Survival"
        onCreate={onCreate}
      />,
    );
    const inputs = screen.getAllByRole("textbox");
    await user.type(inputs[0]!, " Shop ");
    await user.type(inputs[1]!, " Main shop ");
    await user.click(inputs[field]!);
    await user.keyboard("{Enter}");
    expect(onCreate).toHaveBeenCalledExactlyOnceWith({ name: "Shop", description: "Main shop" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("invokes onCreate with name + description", async () => {
    const onCreate = vi.fn();
    render(
      <NewProjectModal open onOpenChange={() => {}} serverLabel="Survival" onCreate={onCreate} />,
    );
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[0]!, { target: { value: "Shop" } });
    fireEvent.change(inputs[1]!, { target: { value: "Main shop" } });
    // "Create" / "Créer"
    fireEvent.click(screen.getByRole("button", { name: /^(create|créer)$/i }));
    expect(onCreate).toHaveBeenCalledWith({ name: "Shop", description: "Main shop" });
  });
});
