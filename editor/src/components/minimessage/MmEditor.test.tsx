import { CHAT, LORE } from "@/lib/mm/profiles";
import type { PlaceholderEntry } from "@/lib/placeholderCatalog";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

// The test environment runs the editor in French (src/i18n).
import { MmEditor } from "./MmEditor";
import { MmTextField } from "./MmTextField";

function Controlled({
  initial,
  profile = CHAT,
  entries,
}: { initial: string; profile?: typeof CHAT; entries?: PlaceholderEntry[] }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <MmEditor value={value} onChange={setValue} profile={profile} entries={entries} />
      <output data-testid="value">{value}</output>
    </>
  );
}

describe("MmEditor", () => {
  it("marks where a lore line will wrap without writing in the text", () => {
    const line = "word ".repeat(20).trim();
    render(<MmEditor value={line} onChange={() => {}} profile={LORE} wrapWidth={60} />);
    const marks = document.querySelectorAll(".cm-mm-wrap");
    expect(marks.length).toBeGreaterThan(0);
    expect((marks[0] as HTMLElement).title).toMatch(/60 px/);
    expect(document.querySelector(".cm-content")!.textContent).toBe(line);
  });

  it("hides the tags in the rich view and shows them in the code view", () => {
    render(<Controlled initial="<red>hello</red>" />);
    const content = () => document.querySelector(".cm-content")!.textContent;
    expect(content()).toBe("hello");
    fireEvent.click(screen.getByRole("button", { name: "Code" }));
    expect(content()).toBe("<red>hello</red>");
  });

  it("flags a click in a lore without removing it", () => {
    render(<Controlled initial="<click:run_command:'/x'>go</click>" profile={LORE} />);
    expect(screen.getByText(/Action au clic : ignoré par Minecraft ici/)).toBeTruthy();
    expect(screen.getByTestId("value").textContent).toBe("<click:run_command:'/x'>go</click>");
  });

  it("offers no click button where the profile forbids it", () => {
    render(<Controlled initial="x" profile={LORE} />);
    expect(screen.queryByRole("button", { name: /Action au clic/ })).toBeNull();
  });

  it("reads a computed text as rules in place, its texts edited there", async () => {
    const entries: PlaceholderEntry[] = [
      { path: "m.online", type: "boolean", sample: "true", origin: "context" },
    ];
    render(
      <Controlled
        initial={'Statut : {m.online ? "<green>En ligne" : "<gray>Hors ligne"}'}
        profile={LORE}
        entries={entries}
      />,
    );
    const box = document.querySelector(".cm-mm-expr") as HTMLElement;
    await waitFor(() => expect(within(box).getByText("Si")).toBeTruthy());
    expect(within(box).getByText("Sinon")).toBeTruthy();
    expect(within(box).getByText("Online")).toBeTruthy();

    fireEvent.click(within(box).getAllByTitle("Modifier ce texte")[1]!);
    fireEvent.change(within(box).getByLabelText("Modifier ce texte"), {
      target: { value: '<red>Absent "loin"' },
    });
    expect(screen.getByTestId("value").textContent).toBe(
      'Statut : {m.online ? "<green>En ligne" : "<red>Absent \\"loin\\""}',
    );
  });

  it("names a placeholder rather than computing it, and says a line break in words", async () => {
    const entries: PlaceholderEntry[] = [
      { path: "m.rank", type: "string", sample: "Officier", origin: "context" },
      { path: "m.kick", type: "boolean", sample: "true", origin: "context" },
    ];
    render(
      <Controlled
        initial={'Grade : {m.rank} {m.kick ? "\\n<red>Exclure" : ""}'}
        profile={LORE}
        entries={entries}
      />,
    );
    const pill = document.querySelector(".cm-mm-val") as HTMLElement;
    await waitFor(() => expect(pill.textContent).toBe("Rank"));
    const box = document.querySelector(".cm-mm-expr") as HTMLElement;
    await waitFor(() => expect(within(box).getByText("nouvelle ligne :")).toBeTruthy());
    expect(within(box).queryByText("Sinon")).toBeNull();
  });

  it("inserts a variable or a built expression from the library", async () => {
    const entries: PlaceholderEntry[] = [
      { path: "m.rank", type: "string", sample: "Officier", origin: "iteration" },
      { path: "m.online", type: "boolean", sample: "true", origin: "iteration" },
    ];
    render(<Controlled initial="Grade : " profile={LORE} entries={entries} />);
    fireEvent.click(screen.getByRole("button", { name: /Bibliothèque/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Rank/ }));
    expect(screen.getByTestId("value").textContent).toBe("Grade : {m.rank}");

    fireEvent.click(screen.getByRole("button", { name: /Bibliothèque/ }));
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "Expressions" }));
    fireEvent.click(await screen.findByRole("button", { name: /Un texte pour oui/ }));
    fireEvent.change(screen.getByLabelText("Texte si oui"), { target: { value: "En ligne" } });
    fireEvent.change(screen.getByLabelText("Texte si non"), { target: { value: "Absent" } });
    expect(screen.getByText("En ligne", { selector: "span" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Insérer" }));
    expect(screen.getByTestId("value").textContent).toBe(
      'Grade : {m.rank}{m.online ? "En ligne" : "Absent"}',
    );
  });

  it("converts legacy codes on request", () => {
    render(<Controlled initial="§6Gold" />);
    fireEvent.click(screen.getByRole("button", { name: "Convertir les codes &" }));
    expect(screen.getByTestId("value").textContent).toBe("<gold>Gold");
  });
});

describe("MmTextField", () => {
  it("shows the preview its profile calls for", () => {
    render(<MmTextField value="<gray>line" onChange={() => {}} profile={LORE} />);
    expect(screen.getByTestId("mc-tooltip")).toBeTruthy();
  });

  it("previews the text for the example player, its placeholders evaluated", () => {
    const entries: PlaceholderEntry[] = [
      { path: "m.rank", type: "string", sample: "Officier", origin: "context" },
    ];
    render(
      <MmTextField value="Grade : {m.rank}" onChange={() => {}} profile={LORE} entries={entries} />,
    );
    const tooltip = screen.getByTestId("mc-tooltip").textContent ?? "";
    expect(tooltip).toContain("Officier");
    expect(tooltip).not.toContain("{m.rank}");
  });

  it("lets the example player be set beside the preview, which follows", () => {
    const entries: PlaceholderEntry[] = [
      { path: "m.online", type: "boolean", sample: "true", origin: "context" },
    ];
    render(
      <MmTextField
        value={'{m.online ? "En ligne" : "Hors ligne"}'}
        onChange={() => {}}
        profile={LORE}
        entries={entries}
      />,
    );
    const tooltip = () => screen.getByTestId("mc-tooltip").textContent ?? "";
    expect(tooltip()).toContain("En ligne");
    fireEvent.click(screen.getByRole("switch", { name: "Online" }));
    expect(tooltip()).toContain("Hors ligne");
    fireEvent.click(screen.getByRole("button", { name: "Revenir aux exemples" }));
    expect(tooltip()).toContain("En ligne");
  });

  it("leaves the preview to the screen with layout none", () => {
    render(<MmTextField value="x" onChange={() => {}} profile={LORE} layout="none" />);
    expect(screen.queryByTestId("mc-tooltip")).toBeNull();
  });
});
