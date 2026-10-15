import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Asset } from "@/domain/asset";
import { McFontText } from "./McFontText";

// Render react-konva primitives as plain divs so jsdom can introspect them
// without a real canvas. Each shape exposes its meaningful props as
// `data-*` attributes so tests can assert positions / dimensions.
vi.mock("react-konva", () => ({
  Group: ({
    children,
    x,
    y,
    listening,
  }: {
    children: React.ReactNode;
    x?: number;
    y?: number;
    listening?: boolean;
  }) => (
    <div data-testid="group" data-x={x} data-y={y} data-listening={listening ? "true" : "false"}>
      {children}
    </div>
  ),
  Image: (props: {
    image?: { src?: string };
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  }) => (
    <div
      data-testid="konva-image"
      data-x={props.x}
      data-y={props.y}
      data-width={props.width}
      data-height={props.height}
      data-src={props.image?.src}
    />
  ),
  Rect: (props: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    fill?: string;
    stroke?: string;
  }) => (
    <div
      data-testid="rect"
      data-x={props.x}
      data-y={props.y}
      data-width={props.width}
      data-height={props.height}
      data-fill={props.fill}
      data-stroke={props.stroke}
    />
  ),
}));

// `use-image` is a React hook that resolves a URL to an HTMLImageElement.
// By default we pretend every image loaded successfully so each glyph
// resolves to a KonvaImage; individual tests override this behaviour with
// `vi.mocked(useImage).mockReturnValue(...)` for the loading/missing cases.
vi.mock("use-image", () => ({
  default: vi.fn(() => [{ src: "fake://img" }, "loaded"]),
}));

import useImage from "use-image";

function makeFontAsset(): Asset {
  return {
    id: "font-1",
    projectId: "p1",
    type: "font",
    name: "demo",
    width: 0,
    height: 0,
    ascent: null,
    codepoint: null,
    fontMeta: {
      namespace: "demo",
      glyphMap: [
        { char: "a", texture: "glyphs/a.png", ascent: 7, height: 9, width: 6 },
        { char: "b", texture: "glyphs/b.png", ascent: 7, height: 9, width: 8 },
        { char: "c", texture: "glyphs/c.png", ascent: 7, height: 9, width: 5 },
      ],
    },
    contentHash: "h",
    createdAt: "",
    updatedAt: "",
  };
}

describe("McFontText", () => {
  it("renders one Konva Image per char when all glyphs are present", () => {
    // Reset mock to default (image loaded) for this test.
    vi.mocked(useImage).mockImplementation(() => [
      { src: "fake://img" } as HTMLImageElement,
      "loaded",
    ]);
    const font = makeFontAsset();
    render(<McFontText text="abc" font={font} x={0} y={0} scale={2} />);
    const imgs = screen.getAllByTestId("konva-image");
    expect(imgs).toHaveLength(3);
  });

  it("renders a yellow-tinted placeholder Rect for missing glyphs", () => {
    vi.mocked(useImage).mockImplementation(() => [
      { src: "fake://img" } as HTMLImageElement,
      "loaded",
    ]);
    const font = makeFontAsset();
    // 'z' is not in the glyphMap.
    render(<McFontText text="az" font={font} x={0} y={0} scale={2} />);
    const rects = screen.getAllByTestId("rect");
    // Exactly one placeholder for 'z'.
    expect(rects).toHaveLength(1);
    expect(rects[0]?.getAttribute("data-fill")).toBe("rgba(245,158,11,0.3)");
    expect(rects[0]?.getAttribute("data-stroke")).toBe("#f59e0b");
    // Placeholder size is 6×8 in MC pixels → 12×16 at scale=2.
    expect(rects[0]?.getAttribute("data-width")).toBe("12");
    expect(rects[0]?.getAttribute("data-height")).toBe("16");
  });

  it("advances the cursor by glyph.width * scale + scale (1px MC kerning) per glyph", () => {
    vi.mocked(useImage).mockImplementation(() => [
      { src: "fake://img" } as HTMLImageElement,
      "loaded",
    ]);
    const font = makeFontAsset();
    // 'a' has width=6, 'b' has width=8, 'c' has width=5. scale=2 means
    // each step adds glyph.width*2 + 2.
    render(<McFontText text="abc" font={font} x={0} y={0} scale={2} />);
    const imgs = screen.getAllByTestId("konva-image");
    expect(imgs[0]?.getAttribute("data-x")).toBe("0");
    // After 'a' (width=6): cursor = 6*2 + 2 = 14
    expect(imgs[1]?.getAttribute("data-x")).toBe("14");
    // After 'b' (width=8): cursor = 14 + 8*2 + 2 = 32
    expect(imgs[2]?.getAttribute("data-x")).toBe("32");
  });

  it("places each glyph at drawY = baselineY - ascent * scale", () => {
    vi.mocked(useImage).mockImplementation(() => [
      { src: "fake://img" } as HTMLImageElement,
      "loaded",
    ]);
    const font = makeFontAsset();
    // ascent=7, scale=2 → drawY = 0 - 7*2 = -14 (relative to the Group origin).
    render(<McFontText text="a" font={font} x={100} y={50} scale={2} />);
    const img = screen.getByTestId("konva-image");
    expect(img.getAttribute("data-y")).toBe("-14");
    // Width = 6 * 2 = 12, height = 9 * 2 = 18.
    expect(img.getAttribute("data-width")).toBe("12");
    expect(img.getAttribute("data-height")).toBe("18");
    // Group is at the supplied (x, y).
    const group = screen.getByTestId("group");
    expect(group.getAttribute("data-x")).toBe("100");
    expect(group.getAttribute("data-y")).toBe("50");
  });

  it("uses each glyph's intrinsic width when laying out a multi-glyph string", () => {
    vi.mocked(useImage).mockImplementation(() => [
      { src: "fake://img" } as HTMLImageElement,
      "loaded",
    ]);
    const font = makeFontAsset();
    // 'a' (width=6) then 'b' (width=8) at scale=3.
    // Expected x for 'b' = 6*3 + 3 = 21.
    render(<McFontText text="ab" font={font} x={0} y={0} scale={3} />);
    const imgs = screen.getAllByTestId("konva-image");
    expect(imgs[0]?.getAttribute("data-x")).toBe("0");
    expect(imgs[1]?.getAttribute("data-x")).toBe("21");
  });

  it("falls back to a neutral grey placeholder Rect while the image is still loading", () => {
    // Pretend `useImage` is still loading: returns `[undefined, "loading"]`.
    vi.mocked(useImage).mockImplementation(() => [undefined, "loading"]);
    const font = makeFontAsset();
    render(<McFontText text="a" font={font} x={0} y={0} scale={2} />);
    // No Konva Image rendered yet.
    expect(screen.queryByTestId("konva-image")).toBeNull();
    // One grey placeholder Rect.
    const rects = screen.getAllByTestId("rect");
    expect(rects).toHaveLength(1);
    expect(rects[0]?.getAttribute("data-fill")).toBe("rgba(120,120,120,0.4)");
    // Size matches the glyph's intrinsic dimensions at scale=2:
    // width=6*2=12, height=9*2=18.
    expect(rects[0]?.getAttribute("data-width")).toBe("12");
    expect(rects[0]?.getAttribute("data-height")).toBe("18");
  });

  it("defaults the Group to listening=false so it doesn't intercept drags on a parent", () => {
    vi.mocked(useImage).mockImplementation(() => [
      { src: "fake://img" } as HTMLImageElement,
      "loaded",
    ]);
    const font = makeFontAsset();
    render(<McFontText text="a" font={font} x={0} y={0} scale={2} />);
    expect(screen.getByTestId("group").getAttribute("data-listening")).toBe("false");
  });

  it("supports surrogate-pair characters by iterating with [...text]", () => {
    vi.mocked(useImage).mockImplementation(() => [
      { src: "fake://img" } as HTMLImageElement,
      "loaded",
    ]);
    const font: Asset = {
      ...makeFontAsset(),
      fontMeta: {
        namespace: "demo",
        glyphMap: [
          // U+1F600 (😀) is a surrogate pair in UTF-16; [...text] yields
          // the single code point, so it should match this entry.
          { char: "\u{1F600}", texture: "glyphs/smile.png", ascent: 7, height: 9, width: 8 },
        ],
      },
    };
    // Note: must use a JSX expression for the unicode escape — JSX string
    // attributes (`text="\u{1F600}"`) treat backslash escapes as literal text.
    render(<McFontText text={"\u{1F600}"} font={font} x={0} y={0} scale={2} />);
    expect(screen.getAllByTestId("konva-image")).toHaveLength(1);
    // If we'd iterated by code unit, we'd see two missing-glyph rects instead.
    expect(screen.queryAllByTestId("rect")).toHaveLength(0);
  });
});
