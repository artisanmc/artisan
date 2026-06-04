import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppearanceSection } from "./AppearanceSection";

describe("AppearanceSection", () => {
  it("renders the editor language switcher", () => {
    render(<AppearanceSection />);
    expect(screen.getByTestId("editor-lang-switcher")).toBeInTheDocument();
  });
});
