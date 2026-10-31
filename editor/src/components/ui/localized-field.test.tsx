import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, it } from "vitest";
import { LocalizedField, missingLangs } from "./localized-field";

function Harness({
  langs = ["en", "fr", "de"],
  activeLang = "en",
  initial = { en: "Back", fr: "" } as Record<string, string | undefined>,
}) {
  const [values, setValues] = useState(initial);
  return (
    <LocalizedField
      label="Title"
      langs={langs}
      activeLang={activeLang}
      defaultLang="en"
      values={values}
      renderEditor={({ lang, value, fallback, label }) => (
        <input
          aria-label={label}
          value={value}
          placeholder={fallback}
          onChange={(e) => setValues((v) => ({ ...v, [lang]: e.target.value }))}
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
