import { afterEach, describe, expect, it } from "vitest";
import { type EditorHost, installEditorHost } from "./host";
import { createModuleI18n } from "./i18n";

function hostIn(lang: string) {
  installEditorHost({ useUiLang: () => lang } as unknown as EditorHost);
}

const useT = createModuleI18n({
  en: { hello: "Hello {{name}}", only: "English only" },
  fr: { hello: "Bonjour {{name}}" },
});

afterEach(() => hostIn("en"));

describe("createModuleI18n", () => {
  it("reads the editor's language and fills placeholders", () => {
    hostIn("fr");
    expect(useT()("hello", { name: "Iban" })).toBe("Bonjour Iban");
  });

  it("falls back to English for a missing key or language", () => {
    hostIn("fr");
    expect(useT()("only")).toBe("English only");
    hostIn("de");
    expect(useT()("hello", { name: "x" })).toBe("Hello x");
  });
});
