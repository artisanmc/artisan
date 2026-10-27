import { describe, expect, it } from "vitest";
import { type Part, quoteText, readExpression, variablesOf } from "./readable";

const partsOf = (src: string): Part[] => {
  const r = readExpression(src);
  if (!r.ok) throw new Error(r.error);
  return r.parts;
};

describe("readExpression", () => {
  it("reads a sum of texts and choices as a list of parts", () => {
    const src =
      '(m.online ? "<green>En ligne" : "<gray>Hors ligne") + (m.can_promote || m.can_kick ? "<newline>" : "") + (m.can_promote ? "<newline><yellow>Clic gauche : promouvoir" : "")';
    const parts = partsOf(src);
    expect(parts.map((p) => p.kind)).toEqual(["choice", "choice", "choice"]);
    const first = parts[0]!;
    if (first.kind !== "choice") throw new Error();
    expect(first.cases[0]!.when).toEqual({ kind: "is", value: { kind: "var", path: "m.online" } });
    expect(first.cases[0]!.show).toMatchObject([{ kind: "text", text: "<green>En ligne" }]);
    expect(first.otherwise).toMatchObject([{ kind: "text", text: "<gray>Hors ligne" }]);
    const second = parts[1]!;
    if (second.kind !== "choice") throw new Error();
    expect(second.cases[0]!.when).toMatchObject({ kind: "any", conds: [{}, {}] });
    expect(parts[2]).toMatchObject({ kind: "choice", otherwise: [] });
  });

  it("points each text at its source, quotes included", () => {
    const src = 'a ? "x\\"y" : \'z\'';
    const parts = partsOf(src);
    const choice = parts[0]!;
    if (choice.kind !== "choice") throw new Error();
    const yes = choice.cases[0]!.show[0]!;
    const no = choice.otherwise[0]!;
    if (yes.kind !== "text" || no.kind !== "text") throw new Error();
    expect(src.slice(yes.at.from, yes.at.to)).toBe('"x\\"y"');
    expect(yes.text).toBe('x"y');
    expect(src.slice(no.at.from, no.at.to)).toBe("'z'");
  });

  it("flattens a chain of ternaries into cases", () => {
    const parts = partsOf('sort == "price" ? "Prix" : sort == "end" ? "Fin" : "Récent"');
    const choice = parts[0]!;
    if (choice.kind !== "choice") throw new Error();
    expect(choice.cases).toHaveLength(2);
    expect(choice.cases[0]!.when).toEqual({
      kind: "compare",
      op: "==",
      left: { kind: "var", path: "sort" },
      right: { kind: "text", text: "price" },
    });
    expect(choice.otherwise).toMatchObject([{ kind: "text", text: "Récent" }]);
  });

  it("keeps a sum of numbers as a sum", () => {
    expect(partsOf("a.count + 1")).toEqual([
      {
        kind: "value",
        value: {
          kind: "math",
          op: "+",
          left: { kind: "var", path: "a.count" },
          right: { kind: "literal", value: 1 },
        },
      },
    ]);
  });

  it("reads methods, indexes, negations and PlaceholderAPI", () => {
    expect(partsOf("player.first_seen.ago()")[0]).toEqual({
      kind: "value",
      value: {
        kind: "method",
        method: "ago",
        target: { kind: "var", path: "player.first_seen" },
        args: [],
      },
    });
    expect(partsOf("summary[0].claims > 0 && !%vault_eco%")[0]).toMatchObject({
      kind: "value",
      value: {
        kind: "cond",
        cond: {
          kind: "all",
          conds: [
            { kind: "compare", left: { kind: "var", path: "summary[0].claims" } },
            { kind: "not", cond: { kind: "is", value: { kind: "papi", name: "vault_eco" } } },
          ],
        },
      },
    });
  });

  it("reports what it cannot parse", () => {
    expect(readExpression('a ? "x"')).toMatchObject({ ok: false });
  });
});

describe("variablesOf", () => {
  it("lists what the `{…}` of a text read, each once, method targets aside", () => {
    expect(
      variablesOf(
        '<red>{m.rank} {m.online && !m.muted ? "x" : m.rank} {m.joined.ago()} {ranks[m.tier]}',
      ),
    ).toEqual(["m.rank", "m.online", "m.muted", "ranks", "m.tier"]);
  });

  it("skips an expression that does not parse", () => {
    expect(variablesOf("{a ? } {b}")).toEqual(["b"]);
  });
});
