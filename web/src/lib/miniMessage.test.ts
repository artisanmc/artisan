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

  it("<newline> and <br/> emit a real \\n", () => {
    expect(parseMiniMessage("a<newline>b")).toEqual([
      { text: "a", style: {} },
      { text: "\n", style: {} },
      { text: "b", style: {} },
    ]);
    expect(parseMiniMessage("a<br/>b")[1]?.text).toBe("\n");
  });

  it("<!bold> turns bold off inside its scope", () => {
    const segs = parseMiniMessage("<bold>a<!bold>b</!bold>c</bold>");
    expect(segs).toEqual([
      { text: "a", style: { bold: true } },
      { text: "b", style: { bold: false } },
      { text: "c", style: { bold: true } },
    ]);
  });

  it("<gradient:red:gold> assigns per-char interpolated colors", () => {
    const segs = parseMiniMessage("<gradient:red:gold>abc</gradient>");
    expect(segs).toHaveLength(3);
    expect(segs[0]?.style.color).toBe("#ff5555");
    expect(segs[2]?.style.color).toBe("#ffaa00");
    // middle char is interpolated halfway
    expect(segs[1]?.style.color).toMatch(/^#/);
  });

  it("<rainbow> emits per-char colors with HSL hue cycle", () => {
    const segs = parseMiniMessage("<rainbow>abcd</rainbow>");
    expect(segs).toHaveLength(4);
    for (const s of segs) expect(s.style.color).toMatch(/^#[0-9a-f]{6}$/);
    // first and last should differ
    expect(segs[0]?.style.color).not.toBe(segs[3]?.style.color);
  });

  it("nested formatting inside <gradient> survives the explode", () => {
    const segs = parseMiniMessage("<gradient:red:gold><bold>ab</bold>c</gradient>");
    expect(segs).toHaveLength(3);
    expect(segs[0]?.style.bold).toBe(true);
    expect(segs[1]?.style.bold).toBe(true);
    expect(segs[2]?.style.bold).toBeFalsy();
    // gradient colors still apply per-char
    expect(segs[0]?.style.color).toBe("#ff5555");
  });

  it("<shadow:gold:0.5> stores shadow on style", () => {
    const segs = parseMiniMessage("<shadow:gold:0.5>x");
    expect(segs[0]?.style.shadow).toEqual({ color: "#ffaa00", alpha: 0.5 });
  });

  it("<pride:trans> uses the trans flag palette", () => {
    const segs = parseMiniMessage("<pride:trans>abcde</pride>");
    expect(segs).toHaveLength(5);
    // first/last char should match the trans palette ends (light blue)
    expect(segs[0]?.style.color).toBe("#5bcefa");
    expect(segs[4]?.style.color).toBe("#5bcefa");
  });

  it("<transition:red:gold:0> picks red across all chars", () => {
    const segs = parseMiniMessage("<transition:red:gold:-1>abc</transition>");
    expect(segs).toHaveLength(1);
    expect(segs[0]?.text).toBe("abc");
    // phase=-1 normalizes to 0 → first color (red)
    expect(segs[0]?.style.color).toBe("#ff5555");
  });

  it("<font:uniform> sets style.font", () => {
    const segs = parseMiniMessage("<font:uniform>x</font>");
    expect(segs[0]?.style.font).toBe("uniform");
  });

  it("<click:run_command:/say hi> marks scope as interactive", () => {
    const segs = parseMiniMessage("<click:run_command:/say hi>click me</click>");
    expect(segs[0]?.style.interactive).toBe(true);
    expect(segs[0]?.text).toBe("click me");
  });

  it("<key> emits a placeholder text segment", () => {
    expect(parseMiniMessage("Press <key:key.jump> to jump")).toEqual([
      { text: "Press ", style: {} },
      { text: "[key.jump]", style: {} },
      { text: " to jump", style: {} },
    ]);
  });

  it("<lang:foo> emits a [lang:foo] placeholder", () => {
    expect(parseMiniMessage("<lang:gui.cancel>")).toEqual([
      { text: "[lang:gui.cancel]", style: {} },
    ]);
  });

  it("scoping tags without a closing tag apply to the rest of the input", () => {
    // Gradient with no </gradient> still colors the trailing text.
    const segs = parseMiniMessage("<gradient:red:gold>abc");
    expect(segs).toHaveLength(3);
    expect(segs[0]?.style.color).toBe("#ff5555");
    expect(segs[2]?.style.color).toBe("#ffaa00");
  });

  it("rainbow without closing tag applies to rest", () => {
    const segs = parseMiniMessage("<rainbow>abcd");
    expect(segs).toHaveLength(4);
    for (const s of segs) expect(s.style.color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("font without closing tag applies to rest", () => {
    const segs = parseMiniMessage("<font:uniform>x");
    expect(segs[0]?.style.font).toBe("uniform");
  });

  it("click without closing tag applies to rest", () => {
    const segs = parseMiniMessage("<click:run_command:/say hi>click here");
    expect(segs[0]?.style.interactive).toBe(true);
    expect(segs[0]?.text).toBe("click here");
  });
});
