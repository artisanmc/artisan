import "@testing-library/jest-dom/vitest";
import i18n from "@/i18n"; // Initialize react-i18next so useTranslation() returns localized strings.

// Pin tests to French — most assertions reference French copy. Browsers in CI
// often advertise "en-US" so the auto-detected language would otherwise flip
// the suite to English. Override here so tests are deterministic.
i18n.changeLanguage("fr");

// jsdom doesn't implement ResizeObserver
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// jsdom doesn't implement matchMedia. Default to "no match" (mobile layout) —
// a test that needs the desktop layout overrides it explicitly.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// jsdom has no layout: Range lacks getClientRects/getBoundingClientRect, which CodeMirror
// calls when it measures in a later animation frame (after a test may have ended).
if (typeof Range !== "undefined") {
  const emptyRect = () =>
    ({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      toJSON() {},
    }) as DOMRect;
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = () =>
      Object.assign([], { item: () => null }) as unknown as DOMRectList;
  }
  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = emptyRect;
  }
}
