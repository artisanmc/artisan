import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSidebarStore } from "@/state/sidebarStore";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NavigationSidebar } from "./NavigationSidebar";

let desktop = true;
vi.mock("@/lib/useMediaQuery", () => ({ useIsDesktop: () => desktop }));

beforeEach(() => {
  desktop = true;
  vi.useFakeTimers();
  useSidebarStore.setState({ isOpen: false, pinned: false });
});
afterEach(() => vi.useRealTimers());

function mount() {
  return render(
    <NavigationSidebar>
      <a href="#project">My project</a>
      <DropdownMenu>
        <DropdownMenuTrigger>Options</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Settings</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </NavigationSidebar>,
  );
}
const panel = () => screen.getByTestId("navigation-sidebar");
const advance = () => act(() => vi.advanceTimersByTime(400));

it("reveals on the left edge and closes after leaving, without changing its reserved width", () => {
  mount();
  expect(panel()).toHaveAttribute("inert");
  fireEvent.mouseEnter(screen.getByTestId("navigation-edge"));
  expect(panel()).not.toHaveAttribute("inert");
  expect(screen.getByTestId("navigation-space")).toHaveAttribute("data-pinned", "false");
  fireEvent.mouseLeave(panel());
  expect(panel()).not.toHaveAttribute("inert");
  advance();
  expect(panel()).toHaveAttribute("inert");
});

it("cancels the delayed close when the pointer comes back", () => {
  mount();
  fireEvent.mouseEnter(screen.getByTestId("navigation-edge"));
  fireEvent.mouseLeave(panel());
  fireEvent.mouseEnter(panel());
  advance();
  expect(panel()).not.toHaveAttribute("inert");
});

it("does not postpone closing when other parts of the page keep updating", async () => {
  mount();
  fireEvent.mouseEnter(screen.getByTestId("navigation-edge"));
  fireEvent.mouseLeave(panel());
  act(() => vi.advanceTimersByTime(200));
  const update = document.createElement("span");
  await act(async () => {
    document.body.append(update);
  });
  act(() => vi.advanceTimersByTime(150));
  expect(panel()).toHaveAttribute("inert");
  update.remove();
});

it("uses the same persistent button to open fixed and close back to automatic mode", () => {
  mount();
  const button = screen.getByRole("button", { name: /ouvrir.*navigation|open navigation/i });
  fireEvent.click(button);
  fireEvent.mouseLeave(panel());
  advance();
  expect(panel()).not.toHaveAttribute("inert");
  expect(screen.getByTestId("navigation-space")).toHaveAttribute("data-pinned", "true");
  expect(screen.getByRole("button", { name: /^fermer.*navigation|^close navigation/i })).toBe(
    button,
  );
  fireEvent.click(button);
  expect(panel()).toHaveAttribute("inert");
  fireEvent.mouseEnter(screen.getByTestId("navigation-edge"));
  expect(panel()).not.toHaveAttribute("inert");
  fireEvent.mouseLeave(panel());
  advance();
  expect(panel()).toHaveAttribute("inert");
});

it("keeps the opening button available during hover and clicking it fixes the panel open", () => {
  mount();
  fireEvent.mouseEnter(screen.getByTestId("navigation-edge"));
  fireEvent.click(screen.getByRole("button", { name: /ouvrir.*navigation|open navigation/i }));
  fireEvent.mouseLeave(panel());
  advance();
  expect(panel()).not.toHaveAttribute("inert");
  fireEvent.click(screen.getByRole("button", { name: /^fermer.*navigation|^close navigation/i }));
  expect(panel()).toHaveAttribute("inert");
});

it("keeps keyboard navigation open and lets Escape return to the toggle", () => {
  mount();
  fireEvent.mouseEnter(screen.getByTestId("navigation-edge"));
  fireEvent.keyDown(window, { key: "Tab" });
  act(() => screen.getByRole("link").focus());
  fireEvent.mouseLeave(panel());
  advance();
  expect(panel()).not.toHaveAttribute("inert");
  fireEvent.keyDown(screen.getByRole("link"), { key: "Escape" });
  expect(panel()).toHaveAttribute("inert");
  expect(screen.getByRole("button", { name: /ouvrir.*navigation|open navigation/i })).toHaveFocus();
});

it("keeps a portalled menu usable after the pointer leaves the sidebar", async () => {
  mount();
  fireEvent.mouseEnter(screen.getByTestId("navigation-edge"));
  fireEvent.pointerDown(screen.getByRole("button", { name: "Options" }), {
    button: 0,
    ctrlKey: false,
  });
  expect(screen.getByRole("menu")).toBeInTheDocument();
  fireEvent.mouseLeave(panel());
  advance();
  expect(panel()).not.toHaveAttribute("inert");
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  await act(async () => {});
  advance();
  expect(panel()).toHaveAttribute("inert");
});

it("uses explicit opening and a backdrop on mobile, regardless of the desktop pin", () => {
  desktop = false;
  useSidebarStore.setState({ pinned: true });
  mount();
  expect(panel()).toHaveAttribute("inert");
  fireEvent.click(screen.getByRole("button", { name: /ouvrir.*navigation|open navigation/i }));
  expect(panel()).not.toHaveAttribute("inert");
  fireEvent.click(screen.getByRole("button", { name: /^fermer.*navigation|^close navigation/i }));
  expect(panel()).toHaveAttribute("inert");
  fireEvent.click(screen.getByRole("button", { name: /ouvrir.*navigation|open navigation/i }));
  fireEvent.click(screen.getByRole("button", { name: /refermer.*navigation|dismiss navigation/i }));
  expect(panel()).toHaveAttribute("inert");
});
