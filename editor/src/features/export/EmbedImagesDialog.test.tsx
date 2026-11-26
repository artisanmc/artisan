import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { useEmbedAsk } from "./EmbedImagesDialog";
import type { AskEmbed } from "./exportElsewhere";

let ask: AskEmbed;
function Host() {
  const embed = useEmbedAsk();
  ask = embed.ask;
  return embed.dialog;
}

const answerOf = async (click: () => void) => {
  let asked!: Promise<boolean | null>;
  act(() => {
    asked = ask(["guilds:crest", "warps:pin"]);
  });
  expect((await screen.findByTestId("export-embed-images")).textContent).toBe(
    "guilds:crestwarps:pin",
  );
  click();
  return asked;
};

it("answers the export with the choice made, and gives it up when closed", async () => {
  render(<Host />);
  expect(screen.queryByTestId("export-embed-images")).toBeNull();
  const press = (name: RegExp) => () => fireEvent.click(screen.getByRole("button", { name }));
  expect(await answerOf(press(/copier et exporter|copy and export/i))).toBe(true);
  expect(screen.queryByTestId("export-embed-images")).toBeNull();
  expect(await answerOf(press(/exporter sans|export without/i))).toBe(false);
  expect(await answerOf(press(/annuler|cancel/i))).toBeNull();
  expect(
    await answerOf(() => fireEvent.keyDown(document.activeElement!, { key: "Escape" })),
  ).toBeNull();
});
