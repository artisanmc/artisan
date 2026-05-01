import { describe, expect, it } from "vitest";
import { parseMiniMessage, plainTextFromMiniMessage } from "./miniMessage";

describe("parseMiniMessage", () => {
  it("returns a single plain segment when there are no tags", () => {
    expect(parseMiniMessage("Hello")).toEqual([{ text: "Hello", style: {} }]);
  });

  it("applies a named color tag", () => {
    expect(parseMiniMessage("<gold>Profil</gold>")).toEqual([
      { text: "Profil", style: { color: "#ffaa00" } },
    ]);
  });

  it("nests bold inside a color and restores both on close", () => {
    const segments = parseMiniMessage("<red>warn <bold>danger</bold> sortie</red>");
    expect(segments).toEqual([
      { text: "warn ", style: { color: "#ff5555" } },
      { text: "danger", style: { color: "#ff5555", bold: true } },
      { text: " sortie", style: { color: "#ff5555" } },
    ]);
  });

  it("supports <#hex> shortcut", () => {
    expect(parseMiniMessage("<#ff00ff>magenta")).toEqual([
      { text: "magenta", style: { color: "#ff00ff" } },
    ]);
  });

  it("supports <color:#hex> form", () => {
    expect(parseMiniMessage("<color:#abcdef>x")).toEqual([
      { text: "x", style: { color: "#abcdef" } },
    ]);
  });

  it("<reset> drops every active style", () => {
    expect(parseMiniMessage("<gold><bold>x</bold><reset>plain")).toEqual([
      { text: "x", style: { color: "#ffaa00", bold: true } },
      { text: "plain", style: {} },
    ]);
  });

  it("escape passes literal angle brackets through", () => {
    expect(parseMiniMessage("a \\< b \\> c")).toEqual([{ text: "a < b > c", style: {} }]);
  });

  it("unknown tag is passed through as literal text", () => {
    expect(parseMiniMessage("<wat>hi</wat>")).toEqual([{ text: "<wat>hi</wat>", style: {} }]);
  });

  it("plainTextFromMiniMessage strips tags", () => {
    expect(plainTextFromMiniMessage("<red>Hello <bold>world</bold></red>!")).toBe("Hello world!");
  });
});
