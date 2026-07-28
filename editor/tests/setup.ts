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
