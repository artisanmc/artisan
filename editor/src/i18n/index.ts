import en from "@/locales/en";
import fr from "@/locales/fr";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

/**
 * Editor UI internationalization. Distinct from `uiStore.activeLang`,
 * which drives the *project content* translation slot the user is
 * editing — a French user translating their project into English keeps
 * the editor in French, so we track the editor's display language
 * separately under `uiStore.editorLang`.
 *
 * Bundled locales: keep them small and inline (no async loading) so
 * the editor never flashes English text on first paint.
 */
export const SUPPORTED_LANGS = ["en", "fr"] as const;
export type SupportedLang = (typeof SUPPORTED_LANGS)[number];

export function isSupportedLang(lang: string): lang is SupportedLang {
  return (SUPPORTED_LANGS as readonly string[]).includes(lang);
}

/**
 * Pick a sensible editor language. Browser primary tag if it's
 * supported, else "en". Used both for the initial uiStore default
 * and as a fallback when persisted state is corrupt.
 */
export function detectEditorLang(): SupportedLang {
  if (typeof navigator === "undefined" || !navigator.language) return "en";
  const primary = navigator.language.slice(0, 2).toLowerCase();
  return isSupportedLang(primary) ? primary : "en";
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    fr: { translation: fr },
  },
  lng: detectEditorLang(),
  fallbackLng: "en",
  interpolation: { escapeValue: false }, // React already escapes
  // Keep keys flat-ish: dots are namespace separators, but we don't
  // load namespaces lazily — everything is in `translation`.
  defaultNS: "translation",
});

export default i18n;
