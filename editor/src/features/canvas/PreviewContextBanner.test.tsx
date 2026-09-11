import { useUiStore } from "@/state/uiStore";
import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { PreviewContextBanner } from "./PreviewContextBanner";

const contexts = [
  { from: "shop", label: "Keys", args: { category: "keys", category_name: "Keys" } },
  { from: "shop", label: "Kits", args: { category: "kits", category_name: "Kits" } },
];
const handlers = new Map<HTMLElement, () => void>();
vi.mock("react-konva", () => ({
  Group: ({ children, onClick }: { children: ReactNode; onClick?: (ev: unknown) => void }) => (
    <div
      ref={(el) => {
        if (el && onClick) handlers.set(el, () => onClick({ cancelBubble: false }));
      }}
    >
      {children}
    </div>
  ),
  Rect: () => null,
  Text: ({ text }: { text: string }) => <span>{text}</span>,
}));
vi.mock("./previewCallContexts", () => ({ findPreviewCallContexts: () => contexts }));
vi.mock("@/lib/themeColors", () => ({ useCssVar: () => "black" }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, args?: { label: string }) => args?.label ?? _key }),
}));

function Banner() {
  const previewArgs = useUiStore((s) => s.menuPreviewArgs.category);
  return (
    <PreviewContextBanner
      menu={{ id: "category", contextInputs: [{ kind: "primitive", name: "category" }] } as never}
      project={{} as never}
      width={180}
      previewArgs={previewArgs}
    />
  );
}

beforeEach(() => {
  handlers.clear();
  useUiStore.setState({ menuPreviewArgs: { category: contexts[0]!.args } });
});

it("keeps the selected context when the canvas dispatches an unbatched click", async () => {
  render(<Banner />);
  await act(async () => handlers.get(screen.getByText("Keys").parentElement!)!());
  // Konva invokes its own handlers, outside React DOM's event batching.
  handlers.get(screen.getByText("shop › Kits").parentElement!)!();
  await act(async () => {});
  expect(useUiStore.getState().menuPreviewArgs.category).toEqual(contexts[1]!.args);
  expect(screen.getByText("Kits")).toBeTruthy();
});

it("keeps a selection when the canvas commits between external store notifications", async () => {
  const view = render(<Banner />);
  await act(async () => handlers.get(screen.getByText("Keys").parentElement!)!());
  // The canvas has a separate reconciler, flushed synchronously by its DOM bridge.
  const unsubscribe = useUiStore.subscribe(() => flushSync(() => view.rerender(<Banner />)));
  try {
    handlers.get(screen.getByText("shop › Kits").parentElement!)!();
    await act(async () => {});
    expect(useUiStore.getState().menuPreviewArgs.category).toEqual(contexts[1]!.args);
  } finally {
    unsubscribe();
  }
});
