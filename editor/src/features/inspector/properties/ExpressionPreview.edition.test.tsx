import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useAuthStore } from "@/state/authStore";
import { ExpressionPreview } from "./ExpressionPreview";

const as = (edition: "free" | "pro") =>
  useAuthStore.setState({ currentUser: { id: "u", name: "Iban", edition } } as never);

describe("ExpressionPreview by edition", () => {
  afterEach(() => useAuthStore.setState({ currentUser: null } as never));

  it("evaluates an advanced expression in Pro", () => {
    as("pro");
    render(<ExpressionPreview expr="1 + 2" />);
    expect(screen.getByText(/3/)).toBeInTheDocument();
  });

  it("keeps the value of an advanced expression for Pro in the free jar", () => {
    as("free");
    render(<ExpressionPreview expr="1 + 2" />);
    expect(screen.getByText("Pro")).toBeInTheDocument();
    expect(screen.queryByText(/3/)).toBeNull();
  });

  it("still evaluates a plain comparison in the free jar", () => {
    as("free");
    render(<ExpressionPreview expr="2 > 1" />);
    expect(screen.queryByText("Pro")).toBeNull();
  });
});
