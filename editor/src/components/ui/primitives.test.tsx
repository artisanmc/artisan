import { render, screen } from "@testing-library/react";
import { Inbox } from "lucide-react";
import { describe, expect, it } from "vitest";
import { Badge } from "./badge";
import { EmptyState } from "./empty-state";
import { FormField } from "./form-field";

describe("Badge", () => {
  it("renders the badge utility classes per variant", () => {
    render(<Badge variant="amber">warn</Badge>);
    const el = screen.getByText("warn");
    expect(el.className).toContain("badge");
    expect(el.className).toContain("badge-amber");
  });

  it("defaults to the sage variant", () => {
    render(<Badge>ok</Badge>);
    expect(screen.getByText("ok").className).toContain("badge-sage");
  });
});

describe("FormField", () => {
  it("associates the label with the control (click-to-focus)", () => {
    render(
      <FormField label="Name">
        <input className="input" />
      </FormField>,
    );
    expect(screen.getByLabelText("Name")).toBeInstanceOf(HTMLInputElement);
  });

  it("renders the optional hint", () => {
    render(
      <FormField label="Key" hint="Keep it secret">
        <input className="input" />
      </FormField>,
    );
    expect(screen.getByText("Keep it secret")).toBeInTheDocument();
  });
});

describe("EmptyState", () => {
  it("renders title, hint and action", () => {
    render(
      <EmptyState
        icon={Inbox}
        title="Nothing here"
        hint="Create one to start"
        action={<button type="button">Create</button>}
      />,
    );
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
    expect(screen.getByText("Create one to start")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
  });
});
