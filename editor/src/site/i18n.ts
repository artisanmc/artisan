import { marketingEn, marketingFr } from "@/locales/marketing";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const LANG_KEY = "artisan.site.lang";

function initialLang(): "en" | "fr" {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === "en" || saved === "fr") return saved;
  } catch {
    /* Storage blocked: fall back to the browser language. */
  }
  return navigator.language?.toLowerCase().startsWith("fr") ? "fr" : "en";
}

export function setSiteLang(lang: "en" | "fr") {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* The choice simply won't survive a reload. */
  }
  void i18n.changeLanguage(lang);
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: { marketing: marketingEn } },
    fr: { translation: { marketing: marketingFr } },
  },
  lng: initialLang(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
