import type { Project } from "@/domain/types";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlayView } from "./PlayView";

const project = (id: string, name: string, command: string): Project =>
  ({
    id,
    name,
    defaultLang: "en",
    i18nKeys: { [`${id}.hi`]: { en: `hello from ${name}` } },
    documents: {
      menu: [],
      command: [
        {
          id: command,
          name: command,
          projectId: id,
          arguments: [],
          steps: [{ kind: "action", action: { name: "send_message", value: { key: `${id}.hi` } } }],
        },
      ],
      dialog: [],
      trigger: [],
    },
    assets: [],
    dataSources: [],
    canvasLayout: {},
  }) as unknown as Project;

describe("PlayView", () => {
  const projects = [project("a", "lobby", "spawn"), project("b", "shop", "buy")];

  it("lists every Project of the server, the focused one first", () => {
    render(<PlayView serverId="s1" projects={projects} focus="b" />);
    const groups = within(screen.getByTestId("play-launcher"))
      .getAllByText(/lobby|shop/)
      .map((el) => el.textContent);
    expect(groups).toEqual(["shop", "lobby"]);
  });

  it("runs a command of any Project from the launcher, into the chat", () => {
    render(<PlayView serverId="s1" projects={projects} />);
    fireEvent.click(screen.getByRole("button", { name: /buy/ }));
    expect(screen.getByTestId("mc-screen-chat")).toHaveTextContent("hello from shop");
  });
});
