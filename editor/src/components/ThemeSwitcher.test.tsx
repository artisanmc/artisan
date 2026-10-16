import { useThemeStore } from "@/state/themeStore";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeSwitcher } from "./ThemeSwitcher";

// Minimal i18next mock — uses real keys as values
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

beforeEach(() => {
  useThemeStore.setState({ theme: "dark" });
  document.documentElement.dataset.theme = "dark";
});

describe("ThemeSwitcher", () => {
  it("renders dark and light buttons", () => {
    render(<ThemeSwitcher />);
    expect(screen.getByTestId("theme-option-dark")).toBeTruthy();
    expect(screen.getByTestId("theme-option-light")).toBeTruthy();
  });

  it("dark button is pressed when theme is dark", () => {
    render(<ThemeSwitcher />);
    expect(screen.getByTestId("theme-option-dark").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("theme-option-light").getAttribute("aria-pressed")).toBe("false");
  });

  it("clicking light calls setTheme('light') and updates html data-theme", () => {
    render(<ThemeSwitcher />);
    fireEvent.click(screen.getByTestId("theme-option-light"));
    expect(useThemeStore.getState().theme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("clicking dark calls setTheme('dark') and updates html data-theme", () => {
    useThemeStore.setState({ theme: "light" });
    render(<ThemeSwitcher />);
    fireEvent.click(screen.getByTestId("theme-option-dark"));
    expect(useThemeStore.getState().theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("button labels match translated keys (bilingual regex)", () => {
    render(<ThemeSwitcher />);
    // With the mock, t() returns the key — check keys contain the right segments
    const darkBtn = screen.getByTestId("theme-option-dark");
    const lightBtn = screen.getByTestId("theme-option-light");
    expect(darkBtn.textContent).toMatch(/dark|sombre/i);
    expect(lightBtn.textContent).toMatch(/light|clair/i);
  });
});
