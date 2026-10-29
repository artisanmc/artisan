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

  it("filters the launcher by name, and says when nothing matches", () => {
    render(<PlayView serverId="s1" projects={projects} />);
    const launcher = screen.getByTestId("play-launcher");
    fireEvent.change(within(launcher).getByRole("searchbox"), { target: { value: "bu" } });
    expect(within(launcher).getByText("/buy")).toBeInTheDocument();
    expect(within(launcher).queryByText("/spawn")).toBeNull();
    expect(within(launcher).queryByText("lobby")).toBeNull();
    fireEvent.change(within(launcher).getByRole("searchbox"), { target: { value: "zzz" } });
    expect(within(launcher).getByText(/Rien ne correspond|Nothing matches/)).toBeInTheDocument();
  });

  it("opens only the focused Project past three, every one while searching", () => {
    const many = ["a", "b", "c", "d"].map((id) => project(id, `p${id}`, `cmd${id}`));
    render(<PlayView serverId="s1" projects={many} focus="c" />);
    const launcher = screen.getByTestId("play-launcher");
    expect(within(launcher).getByText("/cmdc")).toBeInTheDocument();
    expect(within(launcher).queryByText("/cmda")).toBeNull();
    fireEvent.click(within(launcher).getByRole("button", { name: /pa/ }));
    expect(within(launcher).getByText("/cmda")).toBeInTheDocument();
    fireEvent.change(within(launcher).getByRole("searchbox"), { target: { value: "cmd" } });
    expect(within(launcher).getByText("/cmdd")).toBeInTheDocument();
  });

  it("brings the journal forward when an action lands in it", () => {
    render(<PlayView serverId="s1" projects={projects} />);
    expect(screen.queryByTestId("play-log")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /buy/ }));
    expect(screen.getByTestId("play-log")).toBeInTheDocument();
    expect(screen.queryByTestId("play-launcher")).toBeNull();
  });
});
