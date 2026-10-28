import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { documentTitle, useDocumentTitle } from "./documentTitle";

describe("documentTitle", () => {
  it("names the server and the project", () => {
    expect(documentTitle("Lobby", "auctions")).toBe("Artisan | Lobby - auctions");
  });

  it("drops the unknown parts", () => {
    expect(documentTitle("Lobby", null)).toBe("Artisan | Lobby");
    expect(documentTitle(undefined, "auctions")).toBe("Artisan | auctions");
    expect(documentTitle(null, undefined)).toBe("Artisan");
    expect(documentTitle("  ", "")).toBe("Artisan");
  });
});

describe("useDocumentTitle", () => {
  afterEach(() => {
    document.title = "";
  });

  it("follows a project switch and resets on unmount", () => {
    const { rerender, unmount } = renderHook(
      ({ server, project }: { server: string; project?: string }) =>
        useDocumentTitle(server, project),
      { initialProps: { server: "Lobby", project: "auctions" as string | undefined } },
    );
    expect(document.title).toBe("Artisan | Lobby - auctions");
    rerender({ server: "Lobby", project: "quests" });
    expect(document.title).toBe("Artisan | Lobby - quests");
    rerender({ server: "Lobby", project: undefined });
    expect(document.title).toBe("Artisan | Lobby");
    unmount();
    expect(document.title).toBe("Artisan");
  });
});
