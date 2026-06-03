import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ServerDropdown } from "./ServerDropdown";
import { useServersStore } from "@/state/serversStore";

describe("ServerDropdown", () => {
  beforeEach(() => useServersStore.getState().reset());

  it("renders nothing when 0 or 1 servers", () => {
    const { container } = render(<ServerDropdown servers={[]} />);
    expect(container.firstChild).toBeNull();
    const { container: c2 } = render(<ServerDropdown servers={[{ id: "sk1", label: "Solo" }]} />);
    expect(c2.firstChild).toBeNull();
  });

  it("renders a select when ≥2 servers, updates store on change", () => {
    render(<ServerDropdown servers={[
      { id: "sk1", label: "Survival" },
      { id: "sk2", label: "Hub" },
    ]} />);
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "sk2" } });
    expect(useServersStore.getState().activeServerId).toBe("sk2");
  });
});
