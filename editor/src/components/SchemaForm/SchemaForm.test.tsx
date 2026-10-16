import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SchemaForm } from "./SchemaForm";

describe("SchemaForm — primitives", () => {
  it("renders a string field with current value", () => {
    render(
      <SchemaForm
        schema={{ type: "object", properties: { name: { type: "string", title: "Name" } } }}
        value={{ name: "Iban" }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText("Name")).toHaveValue("Iban");
  });

  it("calls onChange with patched object when string changes", () => {
    const changes: any[] = [];
    render(
      <SchemaForm
        schema={{ type: "object", properties: { name: { type: "string", title: "Name" } } }}
        value={{ name: "Iban" }}
        onChange={(v) => changes.push(v)}
      />,
    );
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Iban2" } });
    expect(changes.at(-1)).toEqual({ name: "Iban2" });
  });

  it("renders a number field", () => {
    render(
      <SchemaForm
        schema={{ type: "object", properties: { age: { type: "integer", title: "Age" } } }}
        value={{ age: 42 }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText("Age")).toHaveValue(42);
  });

  it("renders an enum as a select", () => {
    render(
      <SchemaForm
        schema={{
          type: "object",
          properties: {
            role: { type: "string", title: "Role", enum: ["owner", "admin"] },
          },
        }}
        value={{ role: "admin" }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText("Role")).toHaveValue("admin");
  });

  it("renders a boolean as checkbox", () => {
    render(
      <SchemaForm
        schema={{ type: "object", properties: { enabled: { type: "boolean", title: "Enabled" } } }}
        value={{ enabled: true }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText("Enabled")).toBeChecked();
  });
});

describe("SchemaForm — nested + array", () => {
  it("renders nested object fields and propagates changes", () => {
    const changes: any[] = [];
    render(
      <SchemaForm
        schema={{
          type: "object",
          properties: {
            owner: {
              type: "object",
              properties: { name: { type: "string", title: "Owner name" } },
            },
          },
        }}
        value={{ owner: { name: "x" } }}
        onChange={(v) => changes.push(v)}
      />,
    );
    fireEvent.change(screen.getByLabelText("Owner name"), { target: { value: "y" } });
    expect(changes.at(-1)).toEqual({ owner: { name: "y" } });
  });

  it("renders an array of strings with + and − controls", () => {
    const changes: any[] = [];
    render(
      <SchemaForm
        schema={{
          type: "object",
          properties: {
            tags: { type: "array", title: "Tags", items: { type: "string", title: "Tag" } },
          },
        }}
        value={{ tags: ["a", "b"] }}
        onChange={(v) => changes.push(v)}
      />,
    );
    fireEvent.click(screen.getByText("+ Add"));
    expect(changes.at(-1)).toEqual({ tags: ["a", "b", undefined] });
  });
});
