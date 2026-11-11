import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      store = {};
    },
  };
})();
Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, configurable: true });

// Mock matchMedia + localStorage on window (zustand persist uses window.localStorage)
Object.defineProperty(globalThis, "window", {
  value: { matchMedia: vi.fn(() => ({ matches: false })), localStorage: localStorageMock },
  writable: true,
  configurable: true,
});

// Mock document.documentElement.dataset
const datasetMock: Record<string, string> = {};
Object.defineProperty(globalThis, "document", {
  value: {
    documentElement: { dataset: datasetMock },
  },
  writable: true,
  configurable: true,
});

describe("detectInitialTheme", () => {
  beforeEach(() => localStorageMock.clear());

  it("returns 'dark' when localStorage has persisted dark", () => {
    localStorageMock.setItem("artisan.theme", JSON.stringify({ state: { theme: "dark" } }));
    // Re-import to get fresh module state
    vi.resetModules();
    return import("./themeStore").then(({ detectInitialTheme }) => {
      expect(detectInitialTheme()).toBe("dark");
    });
  });

  it("returns 'light' when localStorage has persisted light", () => {
    localStorageMock.setItem("artisan.theme", JSON.stringify({ state: { theme: "light" } }));
    vi.resetModules();
    return import("./themeStore").then(({ detectInitialTheme }) => {
      expect(detectInitialTheme()).toBe("light");
    });
  });

  it("returns 'dark' when OS prefers dark and localStorage is empty", () => {
    (window.matchMedia as ReturnType<typeof vi.fn>).mockReturnValue({ matches: true });
    vi.resetModules();
    return import("./themeStore").then(({ detectInitialTheme }) => {
      expect(detectInitialTheme()).toBe("dark");
    });
  });

  it("returns 'light' when OS prefers light and localStorage is empty", () => {
    (window.matchMedia as ReturnType<typeof vi.fn>).mockReturnValue({ matches: false });
    vi.resetModules();
    return import("./themeStore").then(({ detectInitialTheme }) => {
      expect(detectInitialTheme()).toBe("light");
    });
  });
});

describe("useThemeStore.setTheme", () => {
  beforeEach(() => {
    localStorageMock.clear();
    datasetMock.theme = "";
    vi.resetModules();
    // Re-apply mocks after resetModules so the freshly imported module sees them
    Object.defineProperty(globalThis, "localStorage", {
      value: localStorageMock,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "window", {
      value: { matchMedia: vi.fn(() => ({ matches: false })), localStorage: localStorageMock },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "document", {
      value: { documentElement: { dataset: datasetMock } },
      configurable: true,
      writable: true,
    });
  });
  afterEach(() => vi.clearAllMocks());

  it("mutates document.documentElement.dataset.theme", async () => {
    const { useThemeStore } = await import("./themeStore");
    useThemeStore.getState().setTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("updates store state", async () => {
    const { useThemeStore } = await import("./themeStore");
    useThemeStore.getState().setTheme("dark");
    expect(useThemeStore.getState().theme).toBe("dark");
  });
});
