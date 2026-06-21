import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import ar from "./locales/ar.json";

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ar: { translation: ar } },
  lng: "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

/** Applies a user's language preference: switches i18next AND mirrors the whole
 * UI via the dir attribute (Section 7 — RTL is a full layout mirror, not just text). */
export function applyLanguage(lang: string) {
  i18n.changeLanguage(lang);
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  document.documentElement.lang = lang;
}

export default i18n;
