import { describe, expect, it } from "vitest";
import { plainTextFromMiniMessage } from "../miniMessage";
import {
  clearFormatting,
  deleteVisible,
  diffText,
  removeColor,
  setClick,
  setColor,
  setGradient,
  splitLine,
  toggleDecoration,
} from "./edit";
import { insertionPoint, richLayout } from "./layout";
import { hasLegacyCodes, legacyToMiniMessage } from "./legacy";
import { CHAT, LORE, MOTD, TITLE, diagnose } from "./profiles";
import { parseTree, serialize } from "./tree";

/** Texts written by hand, migrated from production, or broken on purpose. */
const CORPUS = [
  "",
  "plain text",
  "<gold>Profil</gold>",
  "<red>warn <bold>danger</bold> sortie</red>",
  "<#ff00ff>magenta",
  "<color:#abcdef>x</color> <c:red>y</c> <colour:blue>z</colour>",
  "<gold><bold>x</bold><reset>plain",
  "a \\< b \\> c \\\\ d",
  "<wat>hi</wat>",
  "a<newline>b<br>c",
  "<gradient:red:blue>abc</gradient>def",
  "<gradient:#ff0000:#00ff00:0.5><b>Hi</b> there",
  "<rainbow:!>oops",
  "<pride:trans>flag</pride>",
  "<click:run_command:'/spawn'><hover:show_text:'<red>go'>Spawn</hover></click>",
  "<key:key.jump> to <lang:item.minecraft.diamond>",
  "<b><gradient:a:b>x</b>y</gradient>",
  "a < b and c > d",
  "<b>unclosed <i>both",
  "</b>stray close",
  "{player} has %vault_eco_balance%",
  "<shadow:#000000:0.5>shadow</shadow>",
  "<font:uniform>font</font>",
  "émoji 🎉 <red>ça</red>",
  "§6legacy &lcodes",
  "<B>Upper</B>",
];

const apply = (src: string, r: { text: string } | null) => r?.text ?? src;

describe("parseTree", () => {
  it.each(CORPUS)("serializes back byte for byte: %s", (src) => {
    expect(serialize(parseTree(src))).toBe(src);
  });

  it("keeps an unknown tag as text and nests known ones", () => {
    const tree = parseTree("<wat><b>x</b>");
    expect(tree[0]).toEqual({ kind: "text", raw: "<wat>" });
    expect(tree[1]).toMatchObject({ kind: "el", name: "b", close: "</b>" });
  });
});

describe("richLayout", () => {
  it("hides markup and covers every visible character", () => {
    const { hidden, marks } = richLayout("<red>ab</red>c");
    expect(hidden).toEqual([
      { from: 0, to: 5 },
      { from: 7, to: 13 },
    ]);
    expect(marks.map((m) => [m.from, m.to, m.style.color])).toEqual([
      [5, 7, "#ff5555"],
      [13, 14, undefined],
    ]);
  });

  it("hides an escape's backslash, not the character", () => {
    const { hidden, units } = richLayout("a\\<b");
    expect(hidden).toEqual([{ from: 1, to: 2 }]);
    expect(units.map((u) => [u.from, u.to])).toEqual([
      [0, 1],
      [1, 3],
      [3, 4],
    ]);
  });

  it("shows a placeholder tag as a widget", () => {
    const { widgets, hidden } = richLayout("<key:key.jump>!");
    expect(widgets[0]).toMatchObject({ from: 0, to: 14 });
    expect(hidden).toEqual([]);
  });

  it("parses each lore line alone", () => {
    const perLine = richLayout("<red>a\nb", true);
    expect(perLine.marks.find((m) => m.from === 7)?.style.color).toBeUndefined();
    const joined = richLayout("<red>a\nb");
    expect(joined.marks.find((m) => m.to === 8)?.style.color).toBe("#ff5555");
  });
});

describe("insertionPoint", () => {
  const at = (src: string, pos: number) => insertionPoint(src, richLayout(src).units, pos);

  it("continues the style of the character before the caret", () => {
    // Caret after the hidden </b>: the text goes before it, in bold.
    expect(at("<b>abc</b>def", 10)).toBe(6);
  });

  it("takes the line's opening style at its start", () => {
    expect(at("<gold>text</gold>", 0)).toBe(6);
  });

  it("does not move a caret on an empty line", () => {
    expect(at("<gold></gold>", 0)).toBe(0);
  });
});

describe("toggleDecoration", () => {
  it("wraps a selection", () => {
    expect(apply("hello world", toggleDecoration("hello world", 6, 11, "bold"))).toBe(
      "hello <bold>world</bold>",
    );
  });

  it("removes an exact pair, whatever its alias", () => {
    expect(apply("a<b>bc</b>d", toggleDecoration("a<b>bc</b>d", 4, 6, "bold"))).toBe("abcd");
  });

  it("splits an enclosing pair to unbold part of it", () => {
    const src = "<b>abcdef</b>";
    expect(apply(src, toggleDecoration(src, 5, 7, "bold"))).toBe("<b>ab</b>cd<b>ef</b>");
  });

  it("keeps the nesting valid across a boundary", () => {
    const src = "<b>abc</b>def";
    const out = apply(src, setColor(src, 5, 11, "red"));
    expect(out).toBe("<b>ab</b><red><b>c</b>d</red>ef");
    expect(plainTextFromMiniMessage(out)).toBe("abcdef");
  });

  it("returns the same characters selected", () => {
    const res = toggleDecoration("hello world", 6, 11, "italic");
    expect(res?.text.slice(res.selection.from, res.selection.to)).toBe("world");
  });

  it("edits each lore line alone", () => {
    const src = "first\nsecond";
    expect(apply(src, toggleDecoration(src, 2, 9, "bold", true))).toBe(
      "fi<bold>rst</bold>\n<bold>sec</bold>ond",
    );
  });
});

describe("colors", () => {
  it("replaces the color of a range instead of nesting", () => {
    const src = "<red>abc</red>";
    expect(apply(src, setColor(src, 5, 8, "#00ff00"))).toBe("<color:#00ff00>abc</color>");
  });

  it("applies a gradient over inner colors", () => {
    const src = "a<gold>b</gold>c";
    expect(apply(src, setGradient(src, 0, 16, ["#ff0000", "#0000ff"]))).toBe(
      "<gradient:#ff0000:#0000ff>abc</gradient>",
    );
  });

  it("removes colors in a range", () => {
    const src = "<red>abc</red>";
    expect(apply(src, removeColor(src, 6, 7))).toBe("<red>a</red>b<red>c</red>");
  });

  it("escapes a stray < that an inserted tag would capture", () => {
    const src = "a < b c";
    const out = apply(src, setColor(src, 6, 7, "red"));
    expect(plainTextFromMiniMessage(out)).toBe("a < b c");
    expect(out).toBe("a \\< b <red>c</red>");
  });
});

describe("clearFormatting and click", () => {
  it("clears styles but keeps placeholders and unknown tags", () => {
    const src = "<b><red>x</red></b><key:key.jump><wat>";
    expect(apply(src, clearFormatting(src, 0, src.length))).toBe("x<key:key.jump><wat>");
  });

  it("quotes click values", () => {
    const src = "go";
    expect(apply(src, setClick(src, 0, 2, "run_command", "/say it's"))).toBe(
      "<click:run_command:'/say it\\'s'>go</click>",
    );
  });
});

describe("deleteVisible", () => {
  it("keeps tags around the deleted characters", () => {
    expect(deleteVisible("<b>abc</b>d", 4, 5)).toEqual({ text: "<b>ac</b>d", caret: 4 });
  });

  it("drops a pair its deletion emptied, not other empty pairs", () => {
    expect(deleteVisible("<i></i>x<b>abc</b>y", 11, 14).text).toBe("<i></i>xy");
  });

  it("deletes a placeholder chip whole", () => {
    expect(deleteVisible("a<key:key.jump>b", 1, 15).text).toBe("ab");
  });
});

describe("splitLine", () => {
  it("closes and reopens tags around a lore line break", () => {
    expect(splitLine("<red>abcd</red>", 7)).toEqual({ text: "<red>ab</red>\n<red>cd</red>", caret: 19 });
  });
});

describe("diffText", () => {
  it("finds the smallest change", () => {
    expect(diffText("hello world", "hello <b>world</b>")).toEqual({
      from: 6,
      to: 11,
      insert: "<b>world</b>",
    });
  });
});

describe("legacy codes", () => {
  it("converts colors, formats, hex and resets", () => {
    expect(legacyToMiniMessage("§6Gold &lBold §cRed &rplain")).toBe(
      "<gold>Gold <bold>Bold <reset><red>Red <reset>plain",
    );
    expect(legacyToMiniMessage("&#ff8800hex §x§1§2§3§4§5§6x")).toBe(
      "<color:#ff8800>hex <color:#123456>x",
    );
  });

  it("detects them", () => {
    expect(hasLegacyCodes("&7gray")).toBe(true);
    expect(hasLegacyCodes("rock & roll")).toBe(false);
  });
});

describe("diagnose", () => {
  it("flags a click in a lore and leaves it in the text", () => {
    const src = "<click:run_command:'/x'>go</click>";
    expect(diagnose(src, LORE)).toEqual([{ from: 0, to: 24, code: "feature", feature: "click" }]);
    expect(diagnose(src, CHAT)).toEqual([]);
  });

  it("flags extra lines", () => {
    expect(diagnose("a\nb\nc", MOTD)).toEqual([{ from: 3, to: 5, code: "lines" }]);
    expect(diagnose("a\nb", TITLE)[0]?.code).toBe("lines");
  });
});

describe("every operation keeps the displayed text", () => {
  const ops = [
    (s: string, f: number, t: number) => toggleDecoration(s, f, t, "bold"),
    (s: string, f: number, t: number) => setColor(s, f, t, "#123456"),
    (s: string, f: number, t: number) => setGradient(s, f, t, ["red", "blue"]),
    (s: string, f: number, t: number) => removeColor(s, f, t),
    (s: string, f: number, t: number) => clearFormatting(s, f, t),
  ];
  it.each(CORPUS)("on %s", (src) => {
    const plain = plainTextFromMiniMessage(src);
    for (let f = 0; f <= src.length; f += 3) {
      for (let t = f + 1; t <= src.length; t += 4) {
        for (const op of ops) {
          const res = op(src, f, t);
          if (res) expect(plainTextFromMiniMessage(res.text)).toBe(plain);
        }
        const del = deleteVisible(src, f, t);
        expect(serialize(parseTree(del.text))).toBe(del.text);
      }
    }
  });
});
