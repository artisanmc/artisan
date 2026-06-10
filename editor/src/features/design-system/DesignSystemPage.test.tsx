import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DesignSystemPage } from "./DesignSystemPage";

describe("DesignSystemPage", () => {
  it("renders every section of the design system", () => {
    render(<DesignSystemPage />);
    for (const section of [
      "colors",
      "typography",
      "radii-shadows",
      "css-utilities",
      "primitives",
      "app-components",
      "guidelines",
    ]) {
      expect(screen.getByTestId(`ds-section-${section}`)).toBeInTheDocument();
    }
  });

  it("shows the color tokens by var name", () => {
    render(<DesignSystemPage />);
    for (const token of ["--surface", "--surface-raised", "--brand", "--danger", "--text-mut"]) {
      expect(screen.getByText(token)).toBeInTheDocument();
    }
  });

  it("shows every Button variant of the ui/ primitive", () => {
    render(<DesignSystemPage />);
    for (const variant of ["default", "primary", "destructive", "outline", "ghost"]) {
      expect(screen.getByRole("button", { name: variant })).toBeInTheDocument();
    }
  });

  it("shows the Badge, FormField and EmptyState primitives", () => {
    render(<DesignSystemPage />);
    for (const variant of ["amber", "sage", "terra", "brick"]) {
      expect(screen.getByText(variant)).toBeInTheDocument();
    }
    // The wrapping <label>'s accessible name includes the hint text.
    expect(screen.getByLabelText(/Label/)).toBeInstanceOf(HTMLInputElement);
    expect(screen.getByText("EmptyState title")).toBeInTheDocument();
  });

  it("shows the badge + chip utility classes", () => {
    render(<DesignSystemPage />);
    for (const cls of ["badge-amber", "badge-sage", "badge-terra", "badge-brick"]) {
      expect(screen.getByText(cls)).toBeInTheDocument();
    }
    expect(screen.getByText(".chip")).toBeInTheDocument();
  });

  it("embeds a live ThemeSwitcher (colors hint + specimen)", () => {
    render(<DesignSystemPage />);
    expect(screen.getAllByTestId("theme-option-dark")).toHaveLength(2);
    expect(screen.getAllByTestId("theme-option-light")).toHaveLength(2);
  });
});
