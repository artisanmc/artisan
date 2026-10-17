import { useUiLang } from "./host";

/**
 * A module's own interface strings, one dictionary per language: the editor's
 * react-i18next instance is the host's, a module carries its labels with it.
 * `{{name}}` placeholders are replaced from `vars`. Missing language → `en`; missing
 * key → the key itself, so a gap shows instead of an empty label.
 */
export function createModuleI18n<K extends string>(
  dictionaries: { en: Record<K, string> } & Record<string, Partial<Record<K, string>>>,
): () => (key: K, vars?: Record<string, string | number>) => string {
  return function useModuleT() {
    const lang = useUiLang();
    const dict = dictionaries[lang] ?? dictionaries.en;
    return (key, vars) => {
      const raw = dict[key] ?? dictionaries.en[key] ?? key;
      return vars ? raw.replace(/\{\{(\w+)\}\}/g, (all, name) => String(vars[name] ?? all)) : raw;
    };
  };
}
