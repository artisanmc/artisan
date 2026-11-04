import type { FieldTranslate } from "@/lib/aiTranslate";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { LocalizedField, missingLangs } from "./localized-field";

function Harness({
  langs = ["en", "fr", "de"],
  activeLang = "en",
  initial = { en: "Back", fr: "" } as Record<string, string | undefined>,
  translate,
}: {
  langs?: string[];
  activeLang?: string;
  initial?: Record<string, string | undefined>;
  translate?: FieldTranslate;
}) {
  const [values, setValues] = useState(initial);
  return (
    <LocalizedField
      label="Title"
      langs={langs}
      activeLang={activeLang}
      defaultLang="en"
      values={values}
      onChange={(lang, value) => setValues((v) => ({ ...v, [lang]: value }))}
      translate={translate}
      renderEditor={({ value, fallback, label, onChange }) => (
        <input
          aria-label={label}
          value={value}
          placeholder={fallback}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    />
  );
}

it("counts the languages missing a text the default language has", () => {
  expect(missingLangs(["en", "fr", "de"], "en", { en: "Back", fr: " ", de: "Zurück" })).toEqual([
    "fr",
  ]);
  expect(missingLangs(["en", "fr"], "en", { en: "", fr: "" })).toEqual([]);
});

it("is a plain field when the project has one language", () => {
  render(<Harness langs={["en"]} />);
  expect(screen.getByLabelText("Title")).toHaveValue("Back");
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it("edits the active language, the default text only as a placeholder", () => {
  render(<Harness activeLang="fr" />);
  const field = screen.getByLabelText("Title · fr");
  expect(field).toHaveValue("");
  expect(field).toHaveAttribute("placeholder", "Back");
  expect(screen.queryByLabelText("Title · en")).not.toBeInTheDocument();
});

it("unfolds every language in place, the badge following the missing ones", () => {
  render(<Harness />);
  expect(screen.getByTestId("localized-field-missing")).toHaveTextContent("2");
  const toggle = screen.getByRole("button", { name: /2 manquantes \(fr, de\)/i });
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-pressed", "true");
  const labels = screen.getAllByRole("textbox").map((el) => el.getAttribute("aria-label"));
  expect(labels).toEqual(["Title · en", "Title · fr", "Title · de"]);
  fireEvent.change(screen.getByLabelText("Title · fr"), { target: { value: "Retour" } });
  expect(screen.getByTestId("localized-field-missing")).toHaveTextContent("1");
  fireEvent.change(screen.getByLabelText("Title · de"), { target: { value: "Zurück" } });
  expect(screen.queryByTestId("localized-field-missing")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /^traductions$/i }));
  expect(screen.getAllByRole("textbox")).toHaveLength(1);
});

it("does not count a language-neutral text as missing", () => {
  expect(missingLangs(["en", "fr"], "en", { en: "{r.name}" })).toEqual([]);
  expect(missingLangs(["en", "fr"], "en", { en: "<gold>{count} §7/ {max}" })).toEqual([]);
  expect(missingLangs(["en", "fr"], "en", { en: "Members: {count}" })).toEqual(["fr"]);
});

it("writes the reference text into an empty language on purpose", () => {
  render(<Harness langs={["en", "fr"]} />);
  fireEvent.click(screen.getByRole("button", { name: /traductions/i }));
  fireEvent.click(screen.getByRole("button", { name: /reprendre le texte en en fr/i }));
  expect(screen.getByLabelText("Title · fr")).toHaveValue("Back");
  expect(screen.queryByTestId("localized-field-missing")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /reprendre/i })).not.toBeInTheDocument();
});

it("translates the missing languages on the assistant's model, writing each one", async () => {
  const translate = vi.fn<FieldTranslate>().mockResolvedValue({ fr: "Retour" });
  render(<Harness translate={translate} />);
  fireEvent.click(screen.getByRole("button", { name: /2 manquantes/i }));
  fireEvent.click(screen.getByRole("button", { name: "Traduire les 2 langues manquantes" }));
  expect(translate).toHaveBeenCalledWith({
    label: "Title",
    source: "Back",
    sourceLang: "en",
    langs: ["fr", "de"],
  });
  expect(await screen.findByDisplayValue("Retour")).toBeTruthy();
  // German did not come back: still missing, and said so.
  expect(screen.getByRole("alert")).toHaveTextContent(/n’ont pas pu être traduites/);
  expect(screen.getByRole("button", { name: "Traduire la langue manquante" })).toBeTruthy();
});

it("offers no translation without the assistant", () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: /2 manquantes/i }));
  expect(screen.queryByRole("button", { name: /Traduire/ })).toBeNull();
});
