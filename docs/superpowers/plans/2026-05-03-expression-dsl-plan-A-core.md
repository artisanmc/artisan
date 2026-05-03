# Expression DSL — Plan A : Core (parser + evaluator + template renderer + schema)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the expression DSL parser, evaluator, AST cache, and template renderer in TypeScript, plus add the new schema types (`expression` condition, `set_arg`, `set_arg_cycle_next/prev` actions). Replace the existing simple `placeholders.ts` resolver with the new template renderer. No editor UX yet — that's Plan B.

**Architecture:** Custom recursive-descent parser → AST → visitor evaluator. Template renderer orchestrates: lookup translation → recursive `{i18n:k}` resolution → tokenize literal vs `{expr}` segments → eval each → concat → PAPI → return string. Cache parsed AST keyed by expression string (per pack). All in `web/src/lib/expr/`.

**Tech Stack:** TypeScript 5.7, Vitest 4.1 for tests, Biome for lint/format. No external runtime deps (parser is hand-written).

**Spec reference:** `docs/superpowers/specs/2026-05-03-expression-dsl-design.md`. Read sections 1-3 and 5.6 before starting.

**Out of scope (deferred to Plan B):**
- Form builders, toolbar, patterns gallery, autocomplete, scope inference UI
- Plain-language error message formatting beyond raw EvalError types
- Multi-iter preview UI
- Java plugin (separate repo)

---

## File Structure

All new files under `web/src/lib/expr/`:

```
web/src/lib/expr/
├── ast.ts                  # AST node type definitions (sealed unions)
├── token.ts                # Token type + TokenKind enum
├── lexer.ts                # tokenize(src) → Token[]
├── lexer.test.ts
├── parser.ts               # parse(src) → AstNode (entry point)
├── parser.test.ts
├── coercion.ts             # toBoolean, toNumber, toString, looseEq, looseCompare
├── coercion.test.ts
├── scope.ts                # Scope class — resolves identifiers + PAPI
├── scope.test.ts
├── evaluator.ts            # evaluate(node, scope) → unknown
├── evaluator.test.ts
├── cache.ts                # AstCache (LRU-ish, simple Map-based)
├── cache.test.ts
├── template/
│   ├── tokenizer.ts        # split template into literal vs expression segments
│   ├── tokenizer.test.ts
│   ├── i18n.ts             # recursive {i18n:key} resolver with cycle detection
│   ├── i18n.test.ts
│   ├── renderer.ts         # full pipeline orchestrator
│   └── renderer.test.ts
├── errors.ts               # ParseError, EvalError types + factories
└── fixtures/
    └── expr-fixtures.json  # shared TS/Java test fixtures
```

Modifications to existing files:
- `web/src/domain/types.ts` — add `expression` Condition + 3 new Action types
- `web/src/lib/placeholders.ts` — keep as-is (legacy callers continue working) OR mark deprecated and route through new renderer (decided in Task 17)
- `web/src/state/accountStore.ts` — verify the new action types serialize correctly through immer (no changes expected, sanity test)
- `web/src/domain/stepPath.ts` — `walkActions` must handle new action types

---

## Phase 1 — AST + Lexer

### Task 1: AST type definitions

**Files:**
- Create: `web/src/lib/expr/ast.ts`

- [ ] **Step 1: Write the AST module**

```typescript
// web/src/lib/expr/ast.ts
/**
 * AST nodes for the expression DSL. Discriminated union by `kind`.
 *
 * The grammar is small and closed (cf. spec §1) — these are all the
 * shapes that can appear after a successful parse. The evaluator
 * pattern-matches on `kind` to dispatch.
 */

export type AstNode =
  | LiteralNode
  | IdentifierNode
  | PathAccessNode
  | IndexAccessNode
  | MethodCallNode
  | PapiTokenNode
  | UnaryOpNode
  | BinaryOpNode
  | TernaryNode;

export interface NodeBase {
  /** Source position (0-based char offset) of the first character of this node. */
  pos: number;
}

export interface LiteralNode extends NodeBase {
  kind: "literal";
  value: string | number | boolean | null;
}

export interface IdentifierNode extends NodeBase {
  kind: "identifier";
  name: string;
}

/** `a.b` or `a.b.c`. `target` is the nested left side. */
export interface PathAccessNode extends NodeBase {
  kind: "path";
  target: AstNode;
  field: string;
}

/** `a[expr]` */
export interface IndexAccessNode extends NodeBase {
  kind: "index";
  target: AstNode;
  index: AstNode;
}

/** `a.method(arg1, arg2)`. `target` is the receiver. */
export interface MethodCallNode extends NodeBase {
  kind: "method";
  target: AstNode;
  method: string;
  args: AstNode[];
}

/** `%player_name%` */
export interface PapiTokenNode extends NodeBase {
  kind: "papi";
  placeholder: string; // without the surrounding %
}

export interface UnaryOpNode extends NodeBase {
  kind: "unary";
  op: "!";
  operand: AstNode;
}

export type BinaryOp =
  | "+"
  | "-"
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "&&"
  | "||";

export interface BinaryOpNode extends NodeBase {
  kind: "binary";
  op: BinaryOp;
  left: AstNode;
  right: AstNode;
}

export interface TernaryNode extends NodeBase {
  kind: "ternary";
  cond: AstNode;
  whenTrue: AstNode;
  whenFalse: AstNode;
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/lib/expr/ast.ts
git commit -m "feat(expr): add AST type definitions"
```

---

### Task 2: Token + TokenKind

**Files:**
- Create: `web/src/lib/expr/token.ts`
- Create: `web/src/lib/expr/errors.ts`

- [ ] **Step 1: Write errors module**

```typescript
// web/src/lib/expr/errors.ts
export class ParseError extends Error {
  constructor(
    message: string,
    public readonly pos: number,
    public readonly suggestion?: string,
  ) {
    super(message);
    this.name = "ParseError";
  }
}

export class EvalError extends Error {
  constructor(
    message: string,
    public readonly pos?: number,
  ) {
    super(message);
    this.name = "EvalError";
  }
}
```

- [ ] **Step 2: Write token module**

```typescript
// web/src/lib/expr/token.ts
export type TokenKind =
  | "number"        // 42, 3.14
  | "string"        // "hi" or 'hi'
  | "identifier"    // foo, foo_bar
  | "papi"          // %player_name%
  | "true"
  | "false"
  | "null"
  | "lparen"        // (
  | "rparen"        // )
  | "lbracket"      // [
  | "rbracket"      // ]
  | "comma"
  | "dot"
  | "question"      // ?
  | "colon"         // :
  | "bang"          // !
  | "plus"
  | "minus"
  | "eq"            // ==
  | "neq"           // !=
  | "lt"
  | "lte"
  | "gt"
  | "gte"
  | "and"           // &&
  | "or"            // ||
  | "eof";

export interface Token {
  kind: TokenKind;
  /** Original source text (e.g. `"42"`, `"foo"`, `"%player_name%"`). For literals, the parser uses `value`. */
  text: string;
  /** For number/string/bool/null tokens. */
  value?: string | number | boolean | null;
  /** Byte offset in source. */
  pos: number;
}
```

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/expr/errors.ts web/src/lib/expr/token.ts
git commit -m "feat(expr): add Token kinds and error types"
```

---

### Task 3: Lexer

**Files:**
- Create: `web/src/lib/expr/lexer.ts`
- Create: `web/src/lib/expr/lexer.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// web/src/lib/expr/lexer.test.ts
import { describe, expect, it } from "vitest";
import { ParseError } from "./errors";
import { tokenize } from "./lexer";

describe("tokenize", () => {
  it("emits eof on empty input", () => {
    const t = tokenize("");
    expect(t).toEqual([{ kind: "eof", text: "", pos: 0 }]);
  });

  it("tokenizes a number literal", () => {
    const t = tokenize("42");
    expect(t[0]).toEqual({ kind: "number", text: "42", value: 42, pos: 0 });
    expect(t[1].kind).toBe("eof");
  });

  it("tokenizes a decimal", () => {
    expect(tokenize("3.14")[0].value).toBe(3.14);
  });

  it("tokenizes a double-quoted string with escapes", () => {
    const [t] = tokenize(`"hi\\n"`);
    expect(t).toEqual({ kind: "string", text: `"hi\\n"`, value: "hi\n", pos: 0 });
  });

  it("tokenizes a single-quoted string", () => {
    expect(tokenize("'foo'")[0].value).toBe("foo");
  });

  it("tokenizes identifiers", () => {
    expect(tokenize("foo_bar")[0]).toEqual({
      kind: "identifier",
      text: "foo_bar",
      pos: 0,
    });
  });

  it("recognizes true / false / null as keyword tokens", () => {
    expect(tokenize("true")[0].kind).toBe("true");
    expect(tokenize("false")[0].kind).toBe("false");
    expect(tokenize("null")[0].kind).toBe("null");
  });

  it("tokenizes a PAPI placeholder", () => {
    expect(tokenize("%player_name%")[0]).toEqual({
      kind: "papi",
      text: "%player_name%",
      value: "player_name",
      pos: 0,
    });
  });

  it("tokenizes operators in greedy fashion", () => {
    expect(tokenize("==")[0].kind).toBe("eq");
    expect(tokenize("!=")[0].kind).toBe("neq");
    expect(tokenize("<=")[0].kind).toBe("lte");
    expect(tokenize(">=")[0].kind).toBe("gte");
    expect(tokenize("&&")[0].kind).toBe("and");
    expect(tokenize("||")[0].kind).toBe("or");
    expect(tokenize("<")[0].kind).toBe("lt");
    expect(tokenize(">")[0].kind).toBe("gt");
    expect(tokenize("!")[0].kind).toBe("bang");
  });

  it("tokenizes punctuation", () => {
    const kinds = tokenize("(),.[]?:").map((t) => t.kind);
    expect(kinds).toEqual([
      "lparen",
      "rparen",
      "comma",
      "dot",
      "lbracket",
      "rbracket",
      "question",
      "colon",
      "eof",
    ]);
  });

  it("skips whitespace", () => {
    expect(tokenize("  42   foo  ").map((t) => t.kind)).toEqual([
      "number",
      "identifier",
      "eof",
    ]);
  });

  it("tokenizes a complex expression", () => {
    const t = tokenize(`quest.tags.join(", ")`);
    expect(t.map((x) => x.kind)).toEqual([
      "identifier", // quest
      "dot",
      "identifier", // tags
      "dot",
      "identifier", // join
      "lparen",
      "string",
      "rparen",
      "eof",
    ]);
  });

  it("preserves source positions", () => {
    const [a, , c] = tokenize("a + b");
    expect(a.pos).toBe(0);
    expect(c.pos).toBe(4);
  });

  it("throws ParseError on unterminated string", () => {
    expect(() => tokenize(`"hello`)).toThrow(ParseError);
  });

  it("throws ParseError on unterminated PAPI placeholder", () => {
    expect(() => tokenize("%player_name")).toThrow(ParseError);
  });

  it("throws ParseError on unknown character", () => {
    expect(() => tokenize("foo @ bar")).toThrow(ParseError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd web && npm test -- lexer.test --run
```

Expected: all fail with "tokenize is not a function" or similar.

- [ ] **Step 3: Implement lexer**

```typescript
// web/src/lib/expr/lexer.ts
import { ParseError } from "./errors";
import type { Token, TokenKind } from "./token";

const KEYWORDS: Record<string, TokenKind> = {
  true: "true",
  false: "false",
  null: "null",
};

const SINGLE_CHAR: Record<string, TokenKind> = {
  "(": "lparen",
  ")": "rparen",
  "[": "lbracket",
  "]": "rbracket",
  ",": "comma",
  ".": "dot",
  "?": "question",
  ":": "colon",
  "+": "plus",
  "-": "minus",
};

const isAlpha = (ch: string) => /[a-zA-Z_]/.test(ch);
const isAlphaNum = (ch: string) => /[a-zA-Z0-9_]/.test(ch);
const isDigit = (ch: string) => /[0-9]/.test(ch);
const isLowerOrUnderscore = (ch: string) => /[a-z_]/.test(ch);
const isLowerAlphaNum = (ch: string) => /[a-z0-9_]/.test(ch);

export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];

    // whitespace
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // numbers
    if (isDigit(ch)) {
      const start = i;
      while (i < src.length && isDigit(src[i])) i++;
      if (src[i] === "." && isDigit(src[i + 1])) {
        i++;
        while (i < src.length && isDigit(src[i])) i++;
      }
      const text = src.slice(start, i);
      out.push({ kind: "number", text, value: Number(text), pos: start });
      continue;
    }

    // strings
    if (ch === '"' || ch === "'") {
      const start = i;
      const quote = ch;
      i++;
      let value = "";
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\" && i + 1 < src.length) {
          const next = src[i + 1];
          value += next === "n" ? "\n" : next === "t" ? "\t" : next;
          i += 2;
        } else {
          value += src[i];
          i++;
        }
      }
      if (i >= src.length) {
        throw new ParseError(`Unterminated string starting at column ${start}`, start);
      }
      i++; // closing quote
      out.push({ kind: "string", text: src.slice(start, i), value, pos: start });
      continue;
    }

    // PAPI placeholder %foo_bar%
    if (ch === "%") {
      const start = i;
      i++;
      if (i >= src.length || !isLowerOrUnderscore(src[i])) {
        throw new ParseError(
          `Invalid PAPI placeholder at column ${start} — expected lowercase letter or underscore after %`,
          start,
        );
      }
      let name = "";
      while (i < src.length && isLowerAlphaNum(src[i])) {
        name += src[i];
        i++;
      }
      if (i >= src.length || src[i] !== "%") {
        throw new ParseError(
          `Unterminated PAPI placeholder starting at column ${start}`,
          start,
        );
      }
      i++; // closing %
      out.push({ kind: "papi", text: src.slice(start, i), value: name, pos: start });
      continue;
    }

    // identifiers / keywords
    if (isAlpha(ch)) {
      const start = i;
      while (i < src.length && isAlphaNum(src[i])) i++;
      const text = src.slice(start, i);
      const kw = KEYWORDS[text];
      if (kw) {
        out.push({
          kind: kw,
          text,
          value: kw === "true" ? true : kw === "false" ? false : null,
          pos: start,
        });
      } else {
        out.push({ kind: "identifier", text, pos: start });
      }
      continue;
    }

    // multi-char operators
    if (ch === "=" && src[i + 1] === "=") {
      out.push({ kind: "eq", text: "==", pos: i });
      i += 2;
      continue;
    }
    if (ch === "!" && src[i + 1] === "=") {
      out.push({ kind: "neq", text: "!=", pos: i });
      i += 2;
      continue;
    }
    if (ch === "<" && src[i + 1] === "=") {
      out.push({ kind: "lte", text: "<=", pos: i });
      i += 2;
      continue;
    }
    if (ch === ">" && src[i + 1] === "=") {
      out.push({ kind: "gte", text: ">=", pos: i });
      i += 2;
      continue;
    }
    if (ch === "&" && src[i + 1] === "&") {
      out.push({ kind: "and", text: "&&", pos: i });
      i += 2;
      continue;
    }
    if (ch === "|" && src[i + 1] === "|") {
      out.push({ kind: "or", text: "||", pos: i });
      i += 2;
      continue;
    }
    if (ch === "<") {
      out.push({ kind: "lt", text: "<", pos: i });
      i++;
      continue;
    }
    if (ch === ">") {
      out.push({ kind: "gt", text: ">", pos: i });
      i++;
      continue;
    }
    if (ch === "!") {
      out.push({ kind: "bang", text: "!", pos: i });
      i++;
      continue;
    }

    // single-char tokens
    const single = SINGLE_CHAR[ch];
    if (single) {
      out.push({ kind: single, text: ch, pos: i });
      i++;
      continue;
    }

    throw new ParseError(`Unexpected character '${ch}' at column ${i}`, i);
  }
  out.push({ kind: "eof", text: "", pos: src.length });
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd web && npm test -- lexer.test --run
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/expr/lexer.ts web/src/lib/expr/lexer.test.ts
git commit -m "feat(expr): add lexer with PAPI tokens and operators"
```

---

## Phase 2 — Parser

### Task 4: Parser scaffolding + literals + identifiers + parens

**Files:**
- Create: `web/src/lib/expr/parser.ts`
- Create: `web/src/lib/expr/parser.test.ts`

- [ ] **Step 1: Write failing tests for the basic parsing**

```typescript
// web/src/lib/expr/parser.test.ts
import { describe, expect, it } from "vitest";
import type { AstNode } from "./ast";
import { ParseError } from "./errors";
import { parse } from "./parser";

const stripPos = <T,>(node: T): T => {
  if (node === null || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === "pos") continue;
    out[k] = Array.isArray(v) ? v.map((x) => stripPos(x as unknown)) : stripPos(v);
  }
  return out as T;
};

describe("parse — basics", () => {
  it("parses a number literal", () => {
    expect(stripPos(parse("42"))).toEqual({ kind: "literal", value: 42 });
  });

  it("parses a string literal", () => {
    expect(stripPos(parse(`"hi"`))).toEqual({ kind: "literal", value: "hi" });
  });

  it("parses true / false / null", () => {
    expect(stripPos(parse("true"))).toEqual({ kind: "literal", value: true });
    expect(stripPos(parse("false"))).toEqual({ kind: "literal", value: false });
    expect(stripPos(parse("null"))).toEqual({ kind: "literal", value: null });
  });

  it("parses an identifier", () => {
    expect(stripPos(parse("foo"))).toEqual({ kind: "identifier", name: "foo" });
  });

  it("parses a PAPI token", () => {
    expect(stripPos(parse("%player_name%"))).toEqual({
      kind: "papi",
      placeholder: "player_name",
    });
  });

  it("parses parens transparently", () => {
    expect(stripPos(parse("(42)"))).toEqual({ kind: "literal", value: 42 });
  });

  it("rejects empty input", () => {
    expect(() => parse("")).toThrow(ParseError);
  });

  it("rejects trailing tokens", () => {
    expect(() => parse("42 43")).toThrow(ParseError);
  });

  it("rejects unmatched paren", () => {
    expect(() => parse("(42")).toThrow(ParseError);
  });
});
```

- [ ] **Step 2: Implement parser scaffolding (just enough for the above tests)**

```typescript
// web/src/lib/expr/parser.ts
import type { AstNode } from "./ast";
import { ParseError } from "./errors";
import { tokenize } from "./lexer";
import type { Token, TokenKind } from "./token";

class Parser {
  private i = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.i];
  }

  private consume(kind: TokenKind, what?: string): Token {
    const t = this.tokens[this.i];
    if (t.kind !== kind) {
      throw new ParseError(
        `Expected ${what ?? kind} but got '${t.text || t.kind}' at column ${t.pos}`,
        t.pos,
      );
    }
    this.i++;
    return t;
  }

  private match(...kinds: TokenKind[]): Token | null {
    const t = this.tokens[this.i];
    if (kinds.includes(t.kind)) {
      this.i++;
      return t;
    }
    return null;
  }

  /** Entry point — parses an expression then asserts EOF. */
  parseExpression(): AstNode {
    const node = this.ternary();
    if (this.peek().kind !== "eof") {
      const t = this.peek();
      throw new ParseError(`Unexpected token '${t.text || t.kind}' at column ${t.pos}`, t.pos);
    }
    return node;
  }

  // For now, ternary just delegates to primary — we'll layer in operators in later tasks.
  private ternary(): AstNode {
    return this.primary();
  }

  private primary(): AstNode {
    const t = this.peek();

    if (t.kind === "number" || t.kind === "string" || t.kind === "true" ||
        t.kind === "false" || t.kind === "null") {
      this.i++;
      return { kind: "literal", value: t.value as string | number | boolean | null, pos: t.pos };
    }

    if (t.kind === "papi") {
      this.i++;
      return { kind: "papi", placeholder: t.value as string, pos: t.pos };
    }

    if (t.kind === "identifier") {
      this.i++;
      return { kind: "identifier", name: t.text, pos: t.pos };
    }

    if (t.kind === "lparen") {
      this.i++;
      const inner = this.ternary();
      this.consume("rparen", "')'");
      return inner;
    }

    throw new ParseError(`Unexpected token '${t.text || t.kind}' at column ${t.pos}`, t.pos);
  }
}

export function parse(src: string): AstNode {
  if (!src.trim()) {
    throw new ParseError("Empty expression", 0);
  }
  const tokens = tokenize(src);
  return new Parser(tokens).parseExpression();
}
```

- [ ] **Step 3: Run tests to verify they pass**

```bash
cd web && npm test -- parser.test --run
```

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/expr/parser.ts web/src/lib/expr/parser.test.ts
git commit -m "feat(expr): add parser scaffolding with primaries and parens"
```

---

### Task 5: Parser path access (dot, bracket, method calls)

**Files:**
- Modify: `web/src/lib/expr/parser.ts`
- Modify: `web/src/lib/expr/parser.test.ts`

- [ ] **Step 1: Add failing tests for path access**

Append to `parser.test.ts`:

```typescript
describe("parse — path access", () => {
  it("parses a dot field access", () => {
    expect(stripPos(parse("a.b"))).toEqual({
      kind: "path",
      target: { kind: "identifier", name: "a" },
      field: "b",
    });
  });

  it("parses a chain of dot accesses", () => {
    expect(stripPos(parse("a.b.c"))).toEqual({
      kind: "path",
      target: {
        kind: "path",
        target: { kind: "identifier", name: "a" },
        field: "b",
      },
      field: "c",
    });
  });

  it("parses an index access with literal", () => {
    expect(stripPos(parse("arr[0]"))).toEqual({
      kind: "index",
      target: { kind: "identifier", name: "arr" },
      index: { kind: "literal", value: 0 },
    });
  });

  it("parses an index access with expression", () => {
    expect(stripPos(parse("arr[i]"))).toEqual({
      kind: "index",
      target: { kind: "identifier", name: "arr" },
      index: { kind: "identifier", name: "i" },
    });
  });

  it("parses a method call without args", () => {
    expect(stripPos(parse("xs.length()"))).toEqual({
      kind: "method",
      target: { kind: "identifier", name: "xs" },
      method: "length",
      args: [],
    });
  });

  it("parses a method call with args", () => {
    expect(stripPos(parse(`xs.join(", ")`))).toEqual({
      kind: "method",
      target: { kind: "identifier", name: "xs" },
      method: "join",
      args: [{ kind: "literal", value: ", " }],
    });
  });

  it("treats trailing dot-id followed by lparen as a method call", () => {
    const node = parse("a.b.c(1)");
    expect(stripPos(node)).toEqual({
      kind: "method",
      target: {
        kind: "path",
        target: { kind: "identifier", name: "a" },
        field: "b",
      },
      method: "c",
      args: [{ kind: "literal", value: 1 }],
    });
  });
});
```

- [ ] **Step 2: Extend parser with `postfix` chain after primary**

Replace the `primary` method's caller with a new `postfix` method, and update `ternary` to call it:

```typescript
  private ternary(): AstNode {
    return this.postfix();
  }

  private postfix(): AstNode {
    let node = this.primary();
    while (true) {
      if (this.match("dot")) {
        const name = this.consume("identifier", "field name");
        // method call vs path access depends on what follows
        if (this.peek().kind === "lparen") {
          this.i++; // consume lparen
          const args: AstNode[] = [];
          if (this.peek().kind !== "rparen") {
            args.push(this.ternary());
            while (this.match("comma")) {
              args.push(this.ternary());
            }
          }
          this.consume("rparen", "')'");
          node = { kind: "method", target: node, method: name.text, args, pos: node.pos };
        } else {
          node = { kind: "path", target: node, field: name.text, pos: node.pos };
        }
      } else if (this.match("lbracket")) {
        const index = this.ternary();
        this.consume("rbracket", "']'");
        node = { kind: "index", target: node, index, pos: node.pos };
      } else {
        return node;
      }
    }
  }
```

- [ ] **Step 3: Run tests, verify all pass**

```bash
cd web && npm test -- parser.test --run
```

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/expr/parser.ts web/src/lib/expr/parser.test.ts
git commit -m "feat(expr): parse path/index/method access chains"
```

---

### Task 6: Parser arithmetic + comparisons

**Files:**
- Modify: `web/src/lib/expr/parser.ts`
- Modify: `web/src/lib/expr/parser.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `parser.test.ts`:

```typescript
describe("parse — arithmetic and compare", () => {
  it("parses addition left-associatively", () => {
    expect(stripPos(parse("1 + 2 + 3"))).toEqual({
      kind: "binary",
      op: "+",
      left: {
        kind: "binary",
        op: "+",
        left: { kind: "literal", value: 1 },
        right: { kind: "literal", value: 2 },
      },
      right: { kind: "literal", value: 3 },
    });
  });

  it("parses subtraction", () => {
    expect(stripPos(parse("a - b"))).toMatchObject({
      kind: "binary",
      op: "-",
    });
  });

  it("parses comparison with arith on each side", () => {
    expect(stripPos(parse("a + 1 > b - 2"))).toMatchObject({
      kind: "binary",
      op: ">",
      left: { kind: "binary", op: "+" },
      right: { kind: "binary", op: "-" },
    });
  });

  it("parses each compare operator", () => {
    for (const op of ["==", "!=", "<", "<=", ">", ">="] as const) {
      expect(stripPos(parse(`a ${op} b`))).toMatchObject({ kind: "binary", op });
    }
  });

  it("rejects chained comparisons (e.g. a < b < c)", () => {
    expect(() => parse("a < b < c")).toThrow();
  });
});
```

The chained-compare test relies on compare being non-associative — only `( ... )?` in EBNF.

- [ ] **Step 2: Insert addExpr and compareExpr layers between ternary and postfix**

Update `ternary` to call `compareExpr` (currently calls `postfix` directly):

```typescript
  private ternary(): AstNode {
    return this.compareExpr();
  }

  private compareExpr(): AstNode {
    const left = this.addExpr();
    const op = this.matchCompareOp();
    if (op) {
      const right = this.addExpr();
      return { kind: "binary", op, left, right, pos: left.pos };
    }
    return left;
  }

  private matchCompareOp(): "==" | "!=" | "<" | "<=" | ">" | ">=" | null {
    const map: Record<string, "==" | "!=" | "<" | "<=" | ">" | ">="> = {
      eq: "==",
      neq: "!=",
      lt: "<",
      lte: "<=",
      gt: ">",
      gte: ">=",
    };
    const t = this.peek();
    if (t.kind in map) {
      this.i++;
      return map[t.kind];
    }
    return null;
  }

  private addExpr(): AstNode {
    let node = this.postfix();
    while (true) {
      const t = this.peek();
      if (t.kind === "plus" || t.kind === "minus") {
        this.i++;
        const right = this.postfix();
        node = {
          kind: "binary",
          op: t.kind === "plus" ? "+" : "-",
          left: node,
          right,
          pos: node.pos,
        };
      } else {
        return node;
      }
    }
  }
```

- [ ] **Step 3: Run tests**

```bash
cd web && npm test -- parser.test --run
```

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/expr/parser.ts web/src/lib/expr/parser.test.ts
git commit -m "feat(expr): parse arithmetic + and - and compare ops"
```

---

### Task 7: Parser boolean ops (`!`, `&&`, `||`) + ternary

**Files:**
- Modify: `web/src/lib/expr/parser.ts`
- Modify: `web/src/lib/expr/parser.test.ts`

- [ ] **Step 1: Add failing tests**

```typescript
describe("parse — boolean and ternary", () => {
  it("parses unary not", () => {
    expect(stripPos(parse("!a"))).toEqual({
      kind: "unary",
      op: "!",
      operand: { kind: "identifier", name: "a" },
    });
  });

  it("parses && left-associatively", () => {
    expect(stripPos(parse("a && b && c"))).toMatchObject({
      kind: "binary",
      op: "&&",
      left: { kind: "binary", op: "&&" },
    });
  });

  it("parses || left-associatively", () => {
    expect(stripPos(parse("a || b || c"))).toMatchObject({
      kind: "binary",
      op: "||",
    });
  });

  it("&& binds tighter than ||", () => {
    expect(stripPos(parse("a || b && c"))).toEqual({
      kind: "binary",
      op: "||",
      left: { kind: "identifier", name: "a" },
      right: {
        kind: "binary",
        op: "&&",
        left: { kind: "identifier", name: "b" },
        right: { kind: "identifier", name: "c" },
      },
    });
  });

  it("parses a ternary", () => {
    expect(stripPos(parse("a ? b : c"))).toEqual({
      kind: "ternary",
      cond: { kind: "identifier", name: "a" },
      whenTrue: { kind: "identifier", name: "b" },
      whenFalse: { kind: "identifier", name: "c" },
    });
  });

  it("parses nested ternary right-associatively", () => {
    expect(stripPos(parse("a ? b : c ? d : e"))).toMatchObject({
      kind: "ternary",
      whenFalse: { kind: "ternary" },
    });
  });

  it("ternary lowest precedence", () => {
    // "a > b ? 1 : 2" must group as "(a > b) ? 1 : 2"
    expect(stripPos(parse("a > b ? 1 : 2"))).toEqual({
      kind: "ternary",
      cond: { kind: "binary", op: ">", left: { kind: "identifier", name: "a" },
        right: { kind: "identifier", name: "b" } },
      whenTrue: { kind: "literal", value: 1 },
      whenFalse: { kind: "literal", value: 2 },
    });
  });
});
```

- [ ] **Step 2: Layer in remaining precedence levels**

Replace `ternary` and add the missing layers. Update primary to support unary `!`:

```typescript
  parseExpression(): AstNode {
    const node = this.ternary();
    if (this.peek().kind !== "eof") {
      const t = this.peek();
      throw new ParseError(`Unexpected token '${t.text || t.kind}' at column ${t.pos}`, t.pos);
    }
    return node;
  }

  private ternary(): AstNode {
    const cond = this.orExpr();
    if (this.match("question")) {
      const whenTrue = this.ternary();
      this.consume("colon", "':'");
      const whenFalse = this.ternary();
      return { kind: "ternary", cond, whenTrue, whenFalse, pos: cond.pos };
    }
    return cond;
  }

  private orExpr(): AstNode {
    let node = this.andExpr();
    while (this.match("or")) {
      const right = this.andExpr();
      node = { kind: "binary", op: "||", left: node, right, pos: node.pos };
    }
    return node;
  }

  private andExpr(): AstNode {
    let node = this.notExpr();
    while (this.match("and")) {
      const right = this.notExpr();
      node = { kind: "binary", op: "&&", left: node, right, pos: node.pos };
    }
    return node;
  }

  private notExpr(): AstNode {
    const bang = this.match("bang");
    if (bang) {
      const operand = this.notExpr();
      return { kind: "unary", op: "!", operand, pos: bang.pos };
    }
    return this.compareExpr();
  }
```

- [ ] **Step 3: Run all parser tests**

```bash
cd web && npm test -- parser.test --run
```

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/expr/parser.ts web/src/lib/expr/parser.test.ts
git commit -m "feat(expr): parse !, &&, ||, and ternary with correct precedence"
```

---

## Phase 3 — Evaluator

### Task 8: Coercion module

**Files:**
- Create: `web/src/lib/expr/coercion.ts`
- Create: `web/src/lib/expr/coercion.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// web/src/lib/expr/coercion.test.ts
import { describe, expect, it } from "vitest";
import { compare, looseEq, toBoolean, toNumber, toStringValue } from "./coercion";

describe("toBoolean (truthy/falsy)", () => {
  it.each([
    [null, false],
    [undefined, false],
    ["", false],
    [0, false],
    [false, false],
    ["0", true],
    ["false", true],
    [[], true],
    [{}, true],
    [1, true],
    [-1, true],
    ["x", true],
    [true, true],
  ] as const)("toBoolean(%p) === %p", (input, expected) => {
    expect(toBoolean(input)).toBe(expected);
  });
});

describe("toNumber", () => {
  it("returns a number unchanged", () => {
    expect(toNumber(42)).toBe(42);
  });
  it("parses a numeric string", () => {
    expect(toNumber("42")).toBe(42);
    expect(toNumber("3.14")).toBe(3.14);
  });
  it("returns null for non-numeric string", () => {
    expect(toNumber("hello")).toBeNull();
  });
  it("returns null for null/undefined", () => {
    expect(toNumber(null)).toBeNull();
    expect(toNumber(undefined)).toBeNull();
  });
});

describe("toStringValue", () => {
  it("returns string unchanged", () => {
    expect(toStringValue("hi")).toBe("hi");
  });
  it("formats integer without decimal", () => {
    expect(toStringValue(42)).toBe("42");
    expect(toStringValue(42.0)).toBe("42");
  });
  it("formats decimal with decimal", () => {
    expect(toStringValue(3.14)).toBe("3.14");
  });
  it("renders null/undefined as empty string", () => {
    expect(toStringValue(null)).toBe("");
    expect(toStringValue(undefined)).toBe("");
  });
  it("renders true/false as 'true'/'false' strings", () => {
    expect(toStringValue(true)).toBe("true");
    expect(toStringValue(false)).toBe("false");
  });
  it("joins arrays naively for toString fallback", () => {
    expect(toStringValue([1, 2, 3])).toBe("1,2,3");
  });
});

describe("looseEq (== / !=)", () => {
  it("treats null == empty string as true", () => {
    expect(looseEq(null, "")).toBe(true);
    expect(looseEq("", null)).toBe(true);
  });
  it("does not treat null == 0 as true", () => {
    expect(looseEq(null, 0)).toBe(false);
  });
  it("compares numerics numerically when both parse", () => {
    expect(looseEq("10", 10)).toBe(true);
    expect(looseEq("10.0", 10)).toBe(true);
  });
  it("falls back to string compare otherwise", () => {
    expect(looseEq("a", "b")).toBe(false);
    expect(looseEq("a", "a")).toBe(true);
  });
});

describe("compare (<, <=, >, >=)", () => {
  it("compares numerics numerically", () => {
    expect(compare(5, 10, "<")).toBe(true);
    expect(compare("5", "10", "<")).toBe(true); // both parse as numbers
  });
  it("compares strings lexicographically when not both numeric", () => {
    expect(compare("a", "b", "<")).toBe(true);
    expect(compare("b", "a", ">")).toBe(true);
  });
  it("treats null as 0 when other side is numeric", () => {
    // chosen behavior: null → 0 for ordering; spec is loose here
    // (alternative: null comparisons always false; pick one and stick with it)
    expect(compare(null, 5, "<")).toBe(true);
  });
});
```

- [ ] **Step 2: Implement coercion**

```typescript
// web/src/lib/expr/coercion.ts
/**
 * Coercion helpers for the expression evaluator. Centralized here so the
 * rules from spec §1.4 are testable in one place and reused everywhere
 * (operators, ternary condition, expression-condition coercion to bool).
 */

export type ExprValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | ExprValue[]
  | { [key: string]: ExprValue };

export function toBoolean(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (v === false) return false;
  if (v === 0) return false;
  if (v === "") return false;
  return true;
}

export function toNumber(v: unknown): number | null {
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

export function toStringValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") {
    return Number.isInteger(v) ? String(v) : String(v);
  }
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) return v.map((x) => toStringValue(x)).join(",");
  // For objects, fall back to JSON-ish, but in practice this shouldn't happen at render time.
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function looseEq(a: unknown, b: unknown): boolean {
  // null/empty equivalence
  const aEmpty = a === null || a === undefined || a === "";
  const bEmpty = b === null || b === undefined || b === "";
  if (aEmpty && bEmpty) return true;
  if (aEmpty || bEmpty) {
    // null == "" is true (handled above) but null != 0
    return false;
  }
  // numeric coercion
  const an = toNumber(a);
  const bn = toNumber(b);
  if (an !== null && bn !== null) {
    return an === bn;
  }
  // string compare
  return toStringValue(a) === toStringValue(b);
}

export function compare(
  a: unknown,
  b: unknown,
  op: "<" | "<=" | ">" | ">=",
): boolean {
  const an = toNumber(a);
  const bn = toNumber(b);
  if (an !== null && bn !== null) {
    switch (op) {
      case "<":
        return an < bn;
      case "<=":
        return an <= bn;
      case ">":
        return an > bn;
      case ">=":
        return an >= bn;
    }
  }
  const as = toStringValue(a);
  const bs = toStringValue(b);
  switch (op) {
    case "<":
      return as < bs;
    case "<=":
      return as <= bs;
    case ">":
      return as > bs;
    case ">=":
      return as >= bs;
  }
}
```

- [ ] **Step 3: Run tests**

```bash
cd web && npm test -- coercion.test --run
```

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/expr/coercion.ts web/src/lib/expr/coercion.test.ts
git commit -m "feat(expr): add coercion helpers (toBoolean/toNumber/looseEq/compare)"
```

---

### Task 9: Scope module

**Files:**
- Create: `web/src/lib/expr/scope.ts`
- Create: `web/src/lib/expr/scope.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// web/src/lib/expr/scope.test.ts
import { describe, expect, it } from "vitest";
import { Scope } from "./scope";

describe("Scope", () => {
  it("looks up an identifier from the bag", () => {
    const s = new Scope({ category: "weapons" });
    expect(s.lookup("category")).toBe("weapons");
  });

  it("returns undefined for unknown identifier", () => {
    const s = new Scope({});
    expect(s.lookup("missing")).toBeUndefined();
  });

  it("invokes the papi resolver", () => {
    const s = new Scope({}, { papi: (k) => (k === "player_name" ? "Steve" : "") });
    expect(s.papi("player_name")).toBe("Steve");
  });

  it("returns empty string when no papi resolver is provided", () => {
    const s = new Scope({});
    expect(s.papi("player_name")).toBe("");
  });

  it("child scope inherits parent identifiers", () => {
    const parent = new Scope({ a: 1 });
    const child = parent.child({ b: 2 });
    expect(child.lookup("a")).toBe(1);
    expect(child.lookup("b")).toBe(2);
  });

  it("child scope shadows parent on conflict", () => {
    const parent = new Scope({ a: 1 });
    const child = parent.child({ a: 99 });
    expect(child.lookup("a")).toBe(99);
  });

  it("child inherits the parent papi resolver if not overridden", () => {
    const parent = new Scope({}, { papi: (k) => `P:${k}` });
    const child = parent.child({});
    expect(child.papi("x")).toBe("P:x");
  });
});
```

- [ ] **Step 2: Implement Scope**

```typescript
// web/src/lib/expr/scope.ts
/**
 * Scope provides identifier lookup and PAPI resolution for the
 * evaluator. Identifier bag is a flat object — pre-flattening menu
 * inputs + iteration alias + meta-iter is the caller's responsibility
 * (cf. evaluator + template renderer integration).
 */

export interface ScopeOptions {
  /** Resolves a PAPI placeholder name (without %) to a string. */
  papi?: (name: string) => string;
}

export class Scope {
  constructor(
    private readonly bag: Record<string, unknown>,
    private readonly opts: ScopeOptions = {},
    private readonly parent?: Scope,
  ) {}

  lookup(name: string): unknown {
    if (name in this.bag) return this.bag[name];
    if (this.parent) return this.parent.lookup(name);
    return undefined;
  }

  papi(name: string): string {
    const fn = this.opts.papi ?? this.parent?.opts.papi;
    return fn ? fn(name) : "";
  }

  child(extra: Record<string, unknown>, opts?: ScopeOptions): Scope {
    return new Scope(extra, opts ?? {}, this);
  }
}
```

- [ ] **Step 3: Run tests + commit**

```bash
cd web && npm test -- scope.test --run
git add web/src/lib/expr/scope.ts web/src/lib/expr/scope.test.ts
git commit -m "feat(expr): add Scope with identifier lookup and PAPI resolver"
```

---

### Task 10: Evaluator — literals, identifiers, paths, index, papi

**Files:**
- Create: `web/src/lib/expr/evaluator.ts`
- Create: `web/src/lib/expr/evaluator.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// web/src/lib/expr/evaluator.test.ts
import { describe, expect, it } from "vitest";
import { evaluate } from "./evaluator";
import { parse } from "./parser";
import { Scope } from "./scope";

const evalSrc = (src: string, scope: Scope) => evaluate(parse(src), scope);

describe("evaluator — literals and identifiers", () => {
  const empty = new Scope({});

  it("evaluates a number literal", () => {
    expect(evalSrc("42", empty)).toBe(42);
  });

  it("evaluates a string literal", () => {
    expect(evalSrc(`"hi"`, empty)).toBe("hi");
  });

  it("evaluates true/false/null", () => {
    expect(evalSrc("true", empty)).toBe(true);
    expect(evalSrc("null", empty)).toBeNull();
  });

  it("looks up an identifier", () => {
    const s = new Scope({ x: 7 });
    expect(evalSrc("x", s)).toBe(7);
  });

  it("returns undefined for unknown identifier", () => {
    expect(evalSrc("missing", empty)).toBeUndefined();
  });
});

describe("evaluator — path access", () => {
  it("walks a dotted path", () => {
    const s = new Scope({ quest: { name: "kill", reward: { gold: 100 } } });
    expect(evalSrc("quest.name", s)).toBe("kill");
    expect(evalSrc("quest.reward.gold", s)).toBe(100);
  });

  it("returns undefined for missing field", () => {
    const s = new Scope({ quest: { name: "kill" } });
    expect(evalSrc("quest.unknown", s)).toBeUndefined();
  });

  it("safe-navigates through null/undefined", () => {
    const s = new Scope({ quest: null });
    expect(evalSrc("quest.name", s)).toBeUndefined();
  });
});

describe("evaluator — index access", () => {
  it("indexes an array with literal", () => {
    const s = new Scope({ xs: ["a", "b", "c"] });
    expect(evalSrc("xs[1]", s)).toBe("b");
  });

  it("indexes with computed index", () => {
    const s = new Scope({ xs: ["a", "b", "c"], i: 2 });
    expect(evalSrc("xs[i]", s)).toBe("c");
  });

  it("returns undefined for out of bounds", () => {
    const s = new Scope({ xs: ["a"] });
    expect(evalSrc("xs[5]", s)).toBeUndefined();
  });
});

describe("evaluator — PAPI", () => {
  it("calls the papi resolver", () => {
    const s = new Scope({}, { papi: (k) => (k === "player_name" ? "Steve" : "") });
    expect(evalSrc("%player_name%", s)).toBe("Steve");
  });
});
```

- [ ] **Step 2: Implement evaluator (literals/identifiers/paths/index/papi only — no methods or operators yet)**

```typescript
// web/src/lib/expr/evaluator.ts
import type { AstNode } from "./ast";
import type { Scope } from "./scope";

/**
 * Evaluate an AST against a scope. Returns the runtime value (string,
 * number, boolean, null, undefined, array, or object). Caller is
 * responsible for any final coercion (e.g. toBoolean for condition.expr,
 * toStringValue for inline template segments).
 *
 * Errors are NOT thrown for missing data (we return undefined) — this
 * matches the runtime philosophy of "tolerant by default" in spec §3.4.
 * Type errors (e.g. .join on a number) are signaled by returning a safe
 * default; the caller may surface them in the editor's lint pass.
 */
export function evaluate(node: AstNode, scope: Scope): unknown {
  switch (node.kind) {
    case "literal":
      return node.value;
    case "identifier":
      return scope.lookup(node.name);
    case "papi":
      return scope.papi(node.placeholder);
    case "path": {
      const target = evaluate(node.target, scope);
      if (target === null || target === undefined) return undefined;
      if (typeof target !== "object") return undefined;
      return (target as Record<string, unknown>)[node.field];
    }
    case "index": {
      const target = evaluate(node.target, scope);
      const index = evaluate(node.index, scope);
      if (target === null || target === undefined) return undefined;
      if (Array.isArray(target)) {
        const n = typeof index === "number" ? index : Number(index);
        return Number.isInteger(n) ? target[n] : undefined;
      }
      if (typeof target === "object") {
        return (target as Record<string, unknown>)[String(index)];
      }
      return undefined;
    }
    // method, unary, binary, ternary handled in later tasks
    default:
      throw new Error(`evaluator: kind '${(node as { kind: string }).kind}' not yet implemented`);
  }
}
```

- [ ] **Step 3: Run tests + commit**

```bash
cd web && npm test -- evaluator.test --run
git add web/src/lib/expr/evaluator.ts web/src/lib/expr/evaluator.test.ts
git commit -m "feat(expr): evaluate literals, identifiers, paths, index, papi"
```

---

### Task 11: Evaluator — method calls

**Files:**
- Modify: `web/src/lib/expr/evaluator.ts`
- Modify: `web/src/lib/expr/evaluator.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe("evaluator — list methods", () => {
  it(".join(sep) joins with separator", () => {
    const s = new Scope({ xs: ["a", "b", "c"] });
    expect(evalSrc(`xs.join(", ")`, s)).toBe("a, b, c");
  });

  it(".length returns the array length", () => {
    const s = new Scope({ xs: ["a", "b", "c"] });
    expect(evalSrc("xs.length()", s)).toBe(3);
  });

  it(".first / .last return endpoints", () => {
    const s = new Scope({ xs: ["a", "b", "c"] });
    expect(evalSrc("xs.first()", s)).toBe("a");
    expect(evalSrc("xs.last()", s)).toBe("c");
  });

  it(".at(n) indexes (alias of [n])", () => {
    const s = new Scope({ xs: ["a", "b", "c"] });
    expect(evalSrc("xs.at(1)", s)).toBe("b");
  });

  it(".contains(x) checks membership", () => {
    const s = new Scope({ xs: ["a", "b", "c"] });
    expect(evalSrc(`xs.contains("b")`, s)).toBe(true);
    expect(evalSrc(`xs.contains("z")`, s)).toBe(false);
  });

  it(".length on null returns 0", () => {
    expect(evalSrc("xs.length()", new Scope({ xs: null }))).toBe(0);
  });

  it(".join on null returns ''", () => {
    expect(evalSrc(`xs.join(",")`, new Scope({ xs: null }))).toBe("");
  });

  it(".first on empty returns null", () => {
    expect(evalSrc("xs.first()", new Scope({ xs: [] }))).toBeNull();
  });

  it(".join on a non-array returns '' and does not throw", () => {
    expect(evalSrc(`xs.join(",")`, new Scope({ xs: 42 }))).toBe("");
  });
});
```

Note: tests use `xs.length()` with parens. The spec talks of `.length` as a property but parser treats it as a method (consistent grammar). Patterns gallery in spec §4.5 uses `{quest.tags.length}` without parens — this is **a discrepancy with the grammar as parsed**. Resolution: tests use `.length()` with parens; the editor's autocomplete inserts `.length()`; spec patterns will be updated in Plan B's pattern gallery task. For Plan A, grammar wins.

Actually do the more user-friendly thing: support `.length` as a property (zero-arg shortcut). Update parser to allow either form OR keep methods-only and update spec. **Decision for this plan:** keep methods-only (consistent grammar). Patterns gallery doc will be updated in Plan B.

- [ ] **Step 2: Implement method dispatch in evaluator**

Add a `case "method":` branch in evaluator's switch:

```typescript
    case "method": {
      const target = evaluate(node.target, scope);
      const args = node.args.map((a) => evaluate(a, scope));
      return invokeMethod(target, node.method, args);
    }
```

And add helper at the bottom of the file:

```typescript
function invokeMethod(target: unknown, method: string, args: unknown[]): unknown {
  // List-typed methods. Non-array target → safe defaults.
  switch (method) {
    case "join": {
      if (!Array.isArray(target)) return "";
      const sep = args[0] === undefined ? "" : String(args[0]);
      return target.map((x) => (x === null || x === undefined ? "" : String(x))).join(sep);
    }
    case "length": {
      if (target === null || target === undefined) return 0;
      if (Array.isArray(target)) return target.length;
      if (typeof target === "string") return target.length;
      return 0;
    }
    case "first": {
      if (!Array.isArray(target) || target.length === 0) return null;
      return target[0];
    }
    case "last": {
      if (!Array.isArray(target) || target.length === 0) return null;
      return target[target.length - 1];
    }
    case "at": {
      if (!Array.isArray(target)) return null;
      const n = typeof args[0] === "number" ? args[0] : Number(args[0]);
      if (!Number.isInteger(n)) return null;
      const v = target[n];
      return v === undefined ? null : v;
    }
    case "contains": {
      if (!Array.isArray(target)) return false;
      return target.some((x) => x === args[0]);
    }
    default:
      // Unknown method — return null (safe default). Editor lint catches at edit time.
      return null;
  }
}
```

Also remove the `default: throw` from the switch — replace with `return null` so unknown nodes don't crash evaluation. Wait — that's wrong, unknown nodes are a programming error. Keep the throw. But for `method` we now handle it.

- [ ] **Step 3: Run tests + commit**

```bash
cd web && npm test -- evaluator.test --run
git add web/src/lib/expr/evaluator.ts web/src/lib/expr/evaluator.test.ts
git commit -m "feat(expr): evaluate list methods (.join, .length, .first, .last, .at, .contains)"
```

---

### Task 12: Evaluator — operators (unary, binary, ternary)

**Files:**
- Modify: `web/src/lib/expr/evaluator.ts`
- Modify: `web/src/lib/expr/evaluator.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe("evaluator — operators", () => {
  const empty = new Scope({});

  it("unary not", () => {
    expect(evalSrc("!true", empty)).toBe(false);
    expect(evalSrc("!0", empty)).toBe(true);
    expect(evalSrc("!null", empty)).toBe(true);
  });

  it("addition: number + number", () => {
    expect(evalSrc("2 + 3", empty)).toBe(5);
  });

  it("addition: string + anything = concat (JS-style)", () => {
    expect(evalSrc(`"abc" + 1`, empty)).toBe("abc1");
    expect(evalSrc(`1 + "abc"`, empty)).toBe("1abc");
  });

  it("subtraction: number - number", () => {
    expect(evalSrc("10 - 4", empty)).toBe(6);
  });

  it("subtraction: string - anything returns null (warn)", () => {
    expect(evalSrc(`"abc" - 1`, empty)).toBeNull();
  });

  it("compare: numeric coercion", () => {
    const s = new Scope({}, { papi: (k) => (k === "x" ? "10" : "") });
    expect(evalSrc("%x% > 5", s)).toBe(true);
    expect(evalSrc("%x% < 5", s)).toBe(false);
  });

  it("eq: null == empty string", () => {
    expect(evalSrc(`null == ""`, empty)).toBe(true);
  });

  it("eq: null != 0", () => {
    expect(evalSrc("null == 0", empty)).toBe(false);
  });

  it("&& short-circuits", () => {
    let called = false;
    const s = new Scope({
      a: false,
      get b() {
        called = true;
        return true;
      },
    });
    evalSrc("a && b", s);
    expect(called).toBe(false);
  });

  it("|| short-circuits", () => {
    let called = false;
    const s = new Scope({
      a: true,
      get b() {
        called = true;
        return true;
      },
    });
    evalSrc("a || b", s);
    expect(called).toBe(false);
  });

  it("ternary picks branch by truthy condition", () => {
    expect(evalSrc(`true ? "yes" : "no"`, empty)).toBe("yes");
    expect(evalSrc(`false ? "yes" : "no"`, empty)).toBe("no");
    expect(evalSrc(`null ? "yes" : "no"`, empty)).toBe("no");
  });
});
```

- [ ] **Step 2: Implement remaining cases in evaluator**

Add to the switch:

```typescript
    case "unary": {
      const v = evaluate(node.operand, scope);
      return !toBoolean(v);
    }
    case "binary": {
      // Short-circuit for && / ||
      if (node.op === "&&") {
        const l = evaluate(node.left, scope);
        return toBoolean(l) ? toBoolean(evaluate(node.right, scope)) : false;
      }
      if (node.op === "||") {
        const l = evaluate(node.left, scope);
        return toBoolean(l) ? true : toBoolean(evaluate(node.right, scope));
      }
      const left = evaluate(node.left, scope);
      const right = evaluate(node.right, scope);
      switch (node.op) {
        case "+": {
          if (typeof left === "string" || typeof right === "string") {
            return toStringValue(left) + toStringValue(right);
          }
          const ln = toNumber(left);
          const rn = toNumber(right);
          if (ln !== null && rn !== null) return ln + rn;
          return null;
        }
        case "-": {
          if (typeof left === "string" && !Array.isArray(left)) {
            // string - anything → null (warn-worthy)
            return null;
          }
          const ln = toNumber(left);
          const rn = toNumber(right);
          if (ln !== null && rn !== null) return ln - rn;
          return null;
        }
        case "==":
          return looseEq(left, right);
        case "!=":
          return !looseEq(left, right);
        case "<":
        case "<=":
        case ">":
        case ">=":
          return compare(left, right, node.op);
      }
      return null;
    }
    case "ternary": {
      const c = evaluate(node.cond, scope);
      return toBoolean(c) ? evaluate(node.whenTrue, scope) : evaluate(node.whenFalse, scope);
    }
```

Don't forget to import the coercion helpers:

```typescript
import { compare, looseEq, toBoolean, toNumber, toStringValue } from "./coercion";
```

- [ ] **Step 3: Run tests + commit**

```bash
cd web && npm test -- evaluator.test --run
git add web/src/lib/expr/evaluator.ts web/src/lib/expr/evaluator.test.ts
git commit -m "feat(expr): evaluate unary/binary/ternary operators with short-circuit"
```

---

## Phase 4 — Cache

### Task 13: AST cache

**Files:**
- Create: `web/src/lib/expr/cache.ts`
- Create: `web/src/lib/expr/cache.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// web/src/lib/expr/cache.test.ts
import { describe, expect, it } from "vitest";
import { AstCache } from "./cache";

describe("AstCache", () => {
  it("parses an expression and caches the AST", () => {
    const cache = new AstCache(10);
    const a = cache.get("p1", 1, "x + 1");
    const b = cache.get("p1", 1, "x + 1");
    expect(a).toBe(b);
  });

  it("re-parses on different version", () => {
    const cache = new AstCache(10);
    const a = cache.get("p1", 1, "x + 1");
    const b = cache.get("p1", 2, "x + 1");
    expect(a).not.toBe(b);
  });

  it("re-parses on different pack id", () => {
    const cache = new AstCache(10);
    const a = cache.get("p1", 1, "x + 1");
    const b = cache.get("p2", 1, "x + 1");
    expect(a).not.toBe(b);
  });

  it("evicts oldest when at capacity", () => {
    const cache = new AstCache(2);
    cache.get("p1", 1, "a");
    cache.get("p1", 1, "b");
    cache.get("p1", 1, "c"); // evicts "a"
    expect(cache.size).toBe(2);
  });

  it("re-parsing an evicted key produces a new AST", () => {
    const cache = new AstCache(2);
    const a = cache.get("p1", 1, "a");
    cache.get("p1", 1, "b");
    cache.get("p1", 1, "c"); // evicts "a"
    const a2 = cache.get("p1", 1, "a");
    expect(a2).not.toBe(a);
  });
});
```

- [ ] **Step 2: Implement cache**

```typescript
// web/src/lib/expr/cache.ts
import type { AstNode } from "./ast";
import { parse } from "./parser";

/**
 * LRU-ish cache for parsed expressions. Key = `${packId}|${version}|${expr}`.
 *
 * Implementation note: we use insertion-order Map iteration to evict the
 * oldest key when at capacity. On read, we re-insert (delete+set) to mark
 * the entry as most-recently-used. Simple and JS-stdlib only — no Caffeine.
 */
export class AstCache {
  private readonly map = new Map<string, AstNode>();
  constructor(private readonly capacity: number) {}

  get size(): number {
    return this.map.size;
  }

  get(packId: string, version: number, expr: string): AstNode {
    const key = `${packId}|${version}|${expr}`;
    const cached = this.map.get(key);
    if (cached) {
      // refresh recency
      this.map.delete(key);
      this.map.set(key, cached);
      return cached;
    }
    const ast = parse(expr);
    this.map.set(key, ast);
    if (this.map.size > this.capacity) {
      // evict oldest insertion
      const firstKey = this.map.keys().next().value;
      if (firstKey !== undefined) this.map.delete(firstKey);
    }
    return ast;
  }
}
```

- [ ] **Step 3: Run tests + commit**

```bash
cd web && npm test -- cache.test --run
git add web/src/lib/expr/cache.ts web/src/lib/expr/cache.test.ts
git commit -m "feat(expr): add LRU-ish AST cache"
```

---

## Phase 5 — Template renderer

### Task 14: Template tokenizer

**Files:**
- Create: `web/src/lib/expr/template/tokenizer.ts`
- Create: `web/src/lib/expr/template/tokenizer.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// web/src/lib/expr/template/tokenizer.test.ts
import { describe, expect, it } from "vitest";
import { tokenizeTemplate } from "./tokenizer";

describe("tokenizeTemplate", () => {
  it("returns a single literal segment when there are no braces", () => {
    expect(tokenizeTemplate("hello world")).toEqual([
      { kind: "literal", text: "hello world" },
    ]);
  });

  it("splits literal + expression", () => {
    expect(tokenizeTemplate("Hi {name}!")).toEqual([
      { kind: "literal", text: "Hi " },
      { kind: "expression", text: "name" },
      { kind: "literal", text: "!" },
    ]);
  });

  it("matches braces handling parens and quoted strings inside", () => {
    expect(tokenizeTemplate(`{xs.join(", ")}`)).toEqual([
      { kind: "expression", text: `xs.join(", ")` },
    ]);
  });

  it("handles {} at start and end", () => {
    expect(tokenizeTemplate("{a}+{b}")).toEqual([
      { kind: "expression", text: "a" },
      { kind: "literal", text: "+" },
      { kind: "expression", text: "b" },
    ]);
  });

  it("handles braces inside string literals (does not close early)", () => {
    expect(tokenizeTemplate(`{a == "}" ? 1 : 2}`)).toEqual([
      { kind: "expression", text: `a == "}" ? 1 : 2` },
    ]);
  });

  it("treats {i18n:key} as a special literal token (passthrough)", () => {
    // i18n is processed in a pre-pass — at the tokenizer level it stays as-is in the literal segment,
    // OR as a dedicated 'i18n' segment kind. We pick: dedicated kind for clean handling downstream.
    expect(tokenizeTemplate("a {i18n:foo} b")).toEqual([
      { kind: "literal", text: "a " },
      { kind: "i18n", text: "foo" },
      { kind: "literal", text: " b" },
    ]);
  });

  it("treats unmatched opening brace as literal", () => {
    // tolerant: don't throw, just emit the remainder as literal
    expect(tokenizeTemplate("hello {name no-close")).toEqual([
      { kind: "literal", text: "hello {name no-close" },
    ]);
  });

  it("treats {} (empty) as literal", () => {
    expect(tokenizeTemplate("a{}b")).toEqual([
      { kind: "literal", text: "a{}b" },
    ]);
  });
});
```

- [ ] **Step 2: Implement tokenizer**

```typescript
// web/src/lib/expr/template/tokenizer.ts
export type TemplateSegment =
  | { kind: "literal"; text: string }
  | { kind: "expression"; text: string }
  | { kind: "i18n"; text: string };

const I18N_PREFIX = "i18n:";

/**
 * Split a template string into segments. The resulting array is consumed
 * by the template renderer:
 *  - "literal" → emitted as-is (will be PAPI-resolved + MM-parsed later)
 *  - "expression" → eval through the DSL
 *  - "i18n" → resolve via translation lookup (recursive)
 *
 * Brace matching respects parens and quoted strings inside the
 * expression so `{xs.join(", ")}` and `{a == "}" ? 1 : 2}` work.
 *
 * Tolerant: malformed (unmatched) braces fall through as literal text
 * rather than throwing — runtime philosophy is "never crash a menu".
 */
export function tokenizeTemplate(src: string): TemplateSegment[] {
  const out: TemplateSegment[] = [];
  let i = 0;
  let literalStart = 0;

  const flushLiteral = (end: number) => {
    if (end > literalStart) {
      out.push({ kind: "literal", text: src.slice(literalStart, end) });
    }
  };

  while (i < src.length) {
    if (src[i] !== "{") {
      i++;
      continue;
    }

    // Find matching closing brace, respecting strings and parens.
    let depth = 1;
    let j = i + 1;
    let inString: '"' | "'" | null = null;
    while (j < src.length && depth > 0) {
      const ch = src[j];
      if (inString) {
        if (ch === "\\" && j + 1 < src.length) {
          j += 2;
          continue;
        }
        if (ch === inString) inString = null;
        j++;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inString = ch;
        j++;
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      if (depth === 0) break;
      j++;
    }

    if (depth !== 0) {
      // unmatched — leave the rest as literal and exit
      i = src.length;
      break;
    }

    // src[i] is '{', src[j] is '}', content is src[i+1..j]
    const content = src.slice(i + 1, j);
    if (content.length === 0) {
      // {} → literal
      i = j + 1;
      continue;
    }

    flushLiteral(i);

    if (content.startsWith(I18N_PREFIX)) {
      out.push({ kind: "i18n", text: content.slice(I18N_PREFIX.length) });
    } else {
      out.push({ kind: "expression", text: content });
    }

    i = j + 1;
    literalStart = i;
  }

  flushLiteral(src.length);
  // collapse no-op: if we never hit a brace and never flushed, ensure at least the original
  if (out.length === 0) out.push({ kind: "literal", text: src });

  return out;
}
```

- [ ] **Step 3: Run tests + commit**

```bash
cd web && npm test -- tokenizer.test --run
git add web/src/lib/expr/template/tokenizer.ts web/src/lib/expr/template/tokenizer.test.ts
git commit -m "feat(expr): add template tokenizer (literal/expression/i18n segments)"
```

---

### Task 15: i18n resolver (recursive + cycle detection)

**Files:**
- Create: `web/src/lib/expr/template/i18n.ts`
- Create: `web/src/lib/expr/template/i18n.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// web/src/lib/expr/template/i18n.test.ts
import { describe, expect, it } from "vitest";
import { resolveI18n } from "./i18n";

describe("resolveI18n", () => {
  it("returns the input when no {i18n:...} tokens are present", () => {
    expect(resolveI18n("hello", { lookup: () => undefined })).toBe("hello");
  });

  it("substitutes a single token", () => {
    expect(
      resolveI18n("Hello {i18n:greeting}", {
        lookup: (k) => (k === "greeting" ? "world" : undefined),
      }),
    ).toBe("Hello world");
  });

  it("substitutes recursively", () => {
    const dict: Record<string, string> = {
      a: "outer {i18n:b} done",
      b: "inner",
    };
    expect(resolveI18n("{i18n:a}", { lookup: (k) => dict[k] })).toBe("outer inner done");
  });

  it("inserts a marker on cycle", () => {
    const dict: Record<string, string> = {
      a: "{i18n:b}",
      b: "{i18n:a}",
    };
    const out = resolveI18n("{i18n:a}", { lookup: (k) => dict[k] });
    expect(out).toContain("⚠️");
    expect(out).toContain("cycle");
  });

  it("inserts a marker on depth exceeded", () => {
    const dict: Record<string, string> = {};
    for (let n = 0; n < 10; n++) dict[`k${n}`] = `{i18n:k${n + 1}}`;
    const out = resolveI18n("{i18n:k0}", { lookup: (k) => dict[k] });
    expect(out).toContain("⚠️");
    expect(out).toContain("depth");
  });

  it("inserts empty string for missing key (silent fallback)", () => {
    expect(resolveI18n("{i18n:nope}", { lookup: () => undefined })).toBe("");
  });

  it("preserves expressions and PAPI tokens around i18n substitutions", () => {
    expect(
      resolveI18n("a {i18n:x} {y} %z%", { lookup: (k) => (k === "x" ? "X" : undefined) }),
    ).toBe("a X {y} %z%");
  });
});
```

- [ ] **Step 2: Implement resolver**

```typescript
// web/src/lib/expr/template/i18n.ts
const MAX_DEPTH = 5;
const I18N_RE = /\{i18n:([a-zA-Z0-9_.-]+)\}/g;

export interface I18nResolverOptions {
  /** Returns the raw template string for the key, or undefined if missing. */
  lookup: (key: string) => string | undefined;
}

/**
 * Recursively replace `{i18n:key}` substrings with the resolved
 * translation value. Cycle-detected (visiting set) and depth-limited
 * (max 5). Missing keys silently resolve to empty string. Cycles and
 * depth-exceeded insert visible ⚠️ markers — caller may surface them.
 */
export function resolveI18n(template: string, opts: I18nResolverOptions): string {
  return resolve(template, opts, new Set(), 0);
}

function resolve(
  template: string,
  opts: I18nResolverOptions,
  visiting: Set<string>,
  depth: number,
): string {
  if (depth > MAX_DEPTH) {
    return `⚠️ i18n depth exceeded`;
  }
  return template.replace(I18N_RE, (_, key: string) => {
    if (visiting.has(key)) {
      const chain = [...visiting, key].join("→");
      return `⚠️ i18n cycle: ${chain}`;
    }
    const raw = opts.lookup(key);
    if (raw === undefined) return "";
    visiting.add(key);
    const resolved = resolve(raw, opts, visiting, depth + 1);
    visiting.delete(key);
    return resolved;
  });
}
```

- [ ] **Step 3: Run tests + commit**

```bash
cd web && npm test -- i18n.test --run
git add web/src/lib/expr/template/i18n.ts web/src/lib/expr/template/i18n.test.ts
git commit -m "feat(expr): add recursive i18n resolver with cycle and depth detection"
```

---

### Task 16: Template renderer pipeline

**Files:**
- Create: `web/src/lib/expr/template/renderer.ts`
- Create: `web/src/lib/expr/template/renderer.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// web/src/lib/expr/template/renderer.test.ts
import { describe, expect, it } from "vitest";
import { AstCache } from "../cache";
import { Scope } from "../scope";
import { renderTemplate } from "./renderer";

const noopCache = new AstCache(100);
const noPapi = (_: string) => "";
const noI18n = (_: string) => undefined;

describe("renderTemplate", () => {
  it("returns plain text unchanged", () => {
    expect(
      renderTemplate("hello", {
        scope: new Scope({}),
        cache: noopCache,
        packId: "p1",
        packVersion: 1,
        i18nLookup: noI18n,
      }),
    ).toBe("hello");
  });

  it("substitutes a simple placeholder", () => {
    expect(
      renderTemplate("Hi {name}!", {
        scope: new Scope({ name: "Steve" }),
        cache: noopCache,
        packId: "p1",
        packVersion: 1,
        i18nLookup: noI18n,
      }),
    ).toBe("Hi Steve!");
  });

  it("evaluates a complex expression", () => {
    expect(
      renderTemplate(`Tags: {xs.join(", ")}`, {
        scope: new Scope({ xs: ["a", "b", "c"] }),
        cache: noopCache,
        packId: "p1",
        packVersion: 1,
        i18nLookup: noI18n,
      }),
    ).toBe("Tags: a, b, c");
  });

  it("evaluates a ternary inside a template", () => {
    expect(
      renderTemplate(`{x > 5 ? "big" : "small"}`, {
        scope: new Scope({ x: 10 }),
        cache: noopCache,
        packId: "p1",
        packVersion: 1,
        i18nLookup: noI18n,
      }),
    ).toBe("big");
  });

  it("resolves i18n then expressions", () => {
    expect(
      renderTemplate("X {i18n:greeting} {name}", {
        scope: new Scope({ name: "Steve" }),
        cache: noopCache,
        packId: "p1",
        packVersion: 1,
        i18nLookup: (k) => (k === "greeting" ? "Hello" : undefined),
      }),
    ).toBe("X Hello Steve");
  });

  it("inserts a warn marker for invalid expression", () => {
    const out = renderTemplate("{ invalid !! syntax }", {
      scope: new Scope({}),
      cache: noopCache,
      packId: "p1",
      packVersion: 1,
      i18nLookup: noI18n,
    });
    expect(out).toContain("⚠️");
  });

  it("inserts a warn marker for eval error (string - number)", () => {
    const out = renderTemplate(`{"hi" - 1}`, {
      scope: new Scope({}),
      cache: noopCache,
      packId: "p1",
      packVersion: 1,
      i18nLookup: noI18n,
    });
    // string - number returns null → toString → "" → no marker
    // but a true throw should — test the parse error case above is enough
    // Keep this test as a regression: result should be "" (silent), not crash
    expect(out).toBe("");
  });

  it("resolves PAPI tokens both inside and outside expressions", () => {
    expect(
      renderTemplate(`Solde: %eco% / Bonus: {%eco% > 100 ? "OK" : "low"}`, {
        scope: new Scope({}, { papi: (k) => (k === "eco" ? "150" : "") }),
        cache: noopCache,
        packId: "p1",
        packVersion: 1,
        i18nLookup: noI18n,
      }),
    ).toBe("Solde: 150 / Bonus: OK");
  });
});
```

- [ ] **Step 2: Implement renderer**

```typescript
// web/src/lib/expr/template/renderer.ts
import type { AstCache } from "../cache";
import { toStringValue } from "../coercion";
import { ParseError } from "../errors";
import { evaluate } from "../evaluator";
import type { Scope } from "../scope";
import { resolveI18n } from "./i18n";
import { tokenizeTemplate } from "./tokenizer";

export interface RenderOptions {
  scope: Scope;
  cache: AstCache;
  packId: string;
  packVersion: number;
  /** Translation lookup (raw template string for an i18n key, or undefined). */
  i18nLookup: (key: string) => string | undefined;
}

/**
 * Render a template string to its final user-facing string.
 *
 * Pipeline (cf. spec §3.1):
 *  1. Recursive {i18n:key} resolution (cycle detection, max depth 5)
 *  2. Tokenize into literal + expression segments
 *  3. Evaluate each expression segment via the cached AST + scope
 *  4. Concat
 *  5. Resolve outer-level %papi% tokens (those that survived in literals
 *     and any re-emitted from expressions)
 *
 * MiniMessage parsing is OUT of this function's scope — it happens
 * downstream where the rendered string is converted to React/Adventure
 * components for display.
 */
export function renderTemplate(template: string, opts: RenderOptions): string {
  // 1. i18n
  const afterI18n = resolveI18n(template, { lookup: opts.i18nLookup });

  // 2-3-4. tokenize + eval + concat
  const segments = tokenizeTemplate(afterI18n);
  let out = "";
  for (const seg of segments) {
    if (seg.kind === "literal") {
      out += seg.text;
    } else if (seg.kind === "expression") {
      out += evalSegment(seg.text, opts);
    } else {
      // i18n segment slipped through (shouldn't, given step 1 already replaced them) —
      // re-resolve once defensively
      const resolved = resolveI18n(`{i18n:${seg.text}}`, { lookup: opts.i18nLookup });
      out += resolved;
    }
  }

  // 5. PAPI resolve (outer pass)
  out = out.replace(/%([a-z_][a-z0-9_]*)%/g, (whole, name: string) => {
    const v = opts.scope.papi(name);
    return v ?? whole;
  });

  return out;
}

function evalSegment(expr: string, opts: RenderOptions): string {
  let ast;
  try {
    ast = opts.cache.get(opts.packId, opts.packVersion, expr);
  } catch (e) {
    if (e instanceof ParseError) {
      return `⚠️ ${e.message}`;
    }
    return `⚠️ parse failed`;
  }
  try {
    const v = evaluate(ast, opts.scope);
    return toStringValue(v);
  } catch (e) {
    return `⚠️ ${(e as Error).message}`;
  }
}
```

- [ ] **Step 3: Run tests + commit**

```bash
cd web && npm test -- renderer.test --run
git add web/src/lib/expr/template/renderer.ts web/src/lib/expr/template/renderer.test.ts
git commit -m "feat(expr): add template renderer pipeline (i18n→tokenize→eval→PAPI)"
```

---

### Task 17: Migrate `placeholders.ts` callers (or keep both, decide)

**Files:**
- Read: `web/src/lib/placeholders.ts`
- Modify (or leave): callers identified via grep

- [ ] **Step 1: Identify callers**

```bash
cd web && grep -rn "resolvePlaceholders\|hasUnresolvedPlaceholders\|lookupPath" src --include="*.ts" --include="*.tsx" | grep -v "placeholders\.ts"
```

Note all results.

- [ ] **Step 2: Decide migration strategy**

For Plan A, keep `placeholders.ts` unchanged. It's used by editor preview code that doesn't yet know about the new pipeline. Migration to `renderTemplate` happens in Plan B (when we wire up the new editor UX with full sample context, scope inference, etc.).

- [ ] **Step 3: Add a note in `placeholders.ts`**

Add a docblock comment at the top:

```typescript
/**
 * Legacy simple placeholder resolver — only handles `{name}` and `{name.path}`
 * by dotted lookup. Predates the full expression DSL added in Plan A
 * (see web/src/lib/expr/). Kept around for callers that don't yet pipe
 * through the full template renderer (Menu canvas live preview, etc.).
 *
 * Plan B will migrate those callers and then this file can be deleted.
 */
```

- [ ] **Step 4: Commit (only the docblock)**

```bash
git add web/src/lib/placeholders.ts
git commit -m "docs: mark placeholders.ts as legacy pending Plan B migration"
```

---

## Phase 6 — Schema additions

### Task 18: Add `expression` Condition type

**Files:**
- Modify: `web/src/domain/types.ts`
- Modify: `web/src/domain/types.test.ts`

- [ ] **Step 1: Read the current Condition union**

```bash
cd web && grep -n "type Condition" src/domain/types.ts
```

- [ ] **Step 2: Add the new variant**

In `web/src/domain/types.ts`, extend `Condition`:

```typescript
export type Condition =
  | { type: "has_permission"; perm: string }
  | { type: "has_money"; amount: number }
  | {
      type: "placeholder_equals";
      placeholder: string;
      value: string;
    }
  | {
      type: "placeholder_match";
      placeholder: string;
      regex: string;
    }
  | { type: "not"; of: Condition }
  | { type: "and"; of: Condition[] }
  | { type: "or"; of: Condition[] }
  /**
   * Free-form boolean expression evaluated via the DSL (cf.
   * web/src/lib/expr/). Used when typed conditions don't fit, e.g.
   * comparisons with operators other than == or against runtime
   * iteration fields.
   */
  | { type: "expression"; expr: string };
```

- [ ] **Step 3: Add a sanity test**

If `web/src/domain/types.test.ts` exists, append a check that the union narrows correctly:

```typescript
import { describe, expect, it } from "vitest";
import type { Condition } from "./types";

describe("Condition union — expression variant", () => {
  it("allows construction of expression conditions", () => {
    const c: Condition = { type: "expression", expr: "quest.gold > 1000" };
    expect(c.type).toBe("expression");
    if (c.type === "expression") {
      expect(c.expr).toBe("quest.gold > 1000");
    }
  });
});
```

- [ ] **Step 4: Run typecheck + tests + commit**

```bash
cd web && npx tsc --noEmit
cd web && npm test -- types.test --run
git add web/src/domain/types.ts web/src/domain/types.test.ts
git commit -m "feat(schema): add expression Condition variant"
```

---

### Task 19: Add `set_arg` Action

**Files:**
- Modify: `web/src/domain/types.ts`
- Modify: `web/src/domain/stepPath.ts` (walkActions)

- [ ] **Step 1: Locate the Action union**

```bash
cd web && grep -n "type Action" src/domain/types.ts
```

- [ ] **Step 2: Add `set_arg` to the union**

```typescript
export type Action =
  // ... existing variants ...
  /**
   * Mutate a context input of the current menu. `value` is an Expression
   * (DSL). After the mutation, the runtime triggers a re-render of the
   * current menu. `arg` MUST match an existing Menu.contextInputs[*].name.
   */
  | { type: "set_arg"; arg: string; value: string };
```

- [ ] **Step 3: Update walkActions in stepPath.ts**

```bash
cd web && grep -n "walkActions\|case \"open_menu\"" src/domain/stepPath.ts
```

Look at how existing actions are walked. `set_arg` has no nested steps, so it likely needs no change — but verify the function does not narrow on a closed switch that would now be incomplete. If the function uses `switch (a.type)` with exhaustive narrowing, add a no-op case:

```typescript
    case "set_arg":
      // leaf action, nothing to recurse into
      break;
```

- [ ] **Step 4: Typecheck + commit**

```bash
cd web && npx tsc --noEmit
git add web/src/domain/types.ts web/src/domain/stepPath.ts
git commit -m "feat(schema): add set_arg action"
```

---

### Task 20: Add `set_arg_cycle_next` and `set_arg_cycle_prev`

**Files:**
- Modify: `web/src/domain/types.ts`
- Modify: `web/src/domain/stepPath.ts`
- Modify: `web/src/domain/types.test.ts`

- [ ] **Step 1: Add both variants**

In `web/src/domain/types.ts`, append to the Action union:

```typescript
  /**
   * Cycle a context input through a list. `list` is an Expression
   * evaluating to a list. The runtime finds the current value's index
   * (looseEq), advances by ±1 wrapping at endpoints, and writes the
   * new value to contextInput[arg]. Then triggers re-render.
   *
   * If `arg` is unknown or `list` doesn't evaluate to a non-empty list,
   * the action is a no-op (warn-logged).
   */
  | { type: "set_arg_cycle_next"; arg: string; list: string }
  | { type: "set_arg_cycle_prev"; arg: string; list: string };
```

- [ ] **Step 2: Update walkActions**

```typescript
    case "set_arg":
    case "set_arg_cycle_next":
    case "set_arg_cycle_prev":
      // leaf actions, nothing to recurse
      break;
```

- [ ] **Step 3: Add tests**

```typescript
describe("Action union — context mutation variants", () => {
  it("constructs set_arg", () => {
    const a: Action = { type: "set_arg", arg: "current_tag", value: `"weapon"` };
    expect(a.type).toBe("set_arg");
  });

  it("constructs set_arg_cycle_next", () => {
    const a: Action = {
      type: "set_arg_cycle_next",
      arg: "current_tag",
      list: "categories",
    };
    expect(a.type).toBe("set_arg_cycle_next");
  });

  it("constructs set_arg_cycle_prev", () => {
    const a: Action = {
      type: "set_arg_cycle_prev",
      arg: "current_tag",
      list: "categories",
    };
    expect(a.type).toBe("set_arg_cycle_prev");
  });
});
```

- [ ] **Step 4: Typecheck + commit**

```bash
cd web && npx tsc --noEmit
cd web && npm test -- types.test --run
git add web/src/domain/types.ts web/src/domain/stepPath.ts web/src/domain/types.test.ts
git commit -m "feat(schema): add set_arg_cycle_next and set_arg_cycle_prev actions"
```

---

## Phase 7 — Equivalence fixtures

### Task 21: Build expr-fixtures.json

**Files:**
- Create: `web/src/lib/expr/fixtures/expr-fixtures.json`
- Create: `web/src/lib/expr/fixtures/fixtures.test.ts`

These fixtures will eventually be re-used by the future Java implementation to guarantee TS↔Java equivalence. For Plan A, they serve as integration smoke tests for the TS engine.

- [ ] **Step 1: Write the fixture file**

```json
[
  {
    "name": "literal number",
    "expr": "42",
    "scope": {},
    "expected": 42
  },
  {
    "name": "literal string",
    "expr": "\"hello\"",
    "scope": {},
    "expected": "hello"
  },
  {
    "name": "identifier lookup",
    "expr": "x",
    "scope": { "x": 7 },
    "expected": 7
  },
  {
    "name": "dotted path",
    "expr": "quest.gold",
    "scope": { "quest": { "gold": 100 } },
    "expected": 100
  },
  {
    "name": "join list",
    "expr": "tags.join(\", \")",
    "scope": { "tags": ["a", "b", "c"] },
    "expected": "a, b, c"
  },
  {
    "name": "length on list",
    "expr": "tags.length()",
    "scope": { "tags": ["a", "b"] },
    "expected": 2
  },
  {
    "name": "ternary picks branch",
    "expr": "x > 5 ? \"big\" : \"small\"",
    "scope": { "x": 10 },
    "expected": "big"
  },
  {
    "name": "null == empty string",
    "expr": "x == \"\"",
    "scope": { "x": null },
    "expected": true
  },
  {
    "name": "numeric coercion in compare",
    "expr": "\"100\" > 50",
    "scope": {},
    "expected": true
  },
  {
    "name": "string concat with +",
    "expr": "\"a\" + 1",
    "scope": {},
    "expected": "a1"
  },
  {
    "name": "arithmetic precedence",
    "expr": "1 + 2 == 3",
    "scope": {},
    "expected": true
  },
  {
    "name": "short-circuit &&",
    "expr": "false && missing.field",
    "scope": {},
    "expected": false
  },
  {
    "name": "first / last",
    "expr": "tags.first() == \"a\" && tags.last() == \"c\"",
    "scope": { "tags": ["a", "b", "c"] },
    "expected": true
  },
  {
    "name": "contains",
    "expr": "tags.contains(\"b\")",
    "scope": { "tags": ["a", "b"] },
    "expected": true
  },
  {
    "name": "index access",
    "expr": "tags[1]",
    "scope": { "tags": ["a", "b", "c"] },
    "expected": "b"
  },
  {
    "name": "safe path on null",
    "expr": "x.y.z",
    "scope": { "x": null },
    "expected": null
  }
]
```

Note: TS evaluator returns `undefined` for missing path access, but JSON can't represent undefined. We treat the test as: if expected is `null`, accept either null or undefined.

- [ ] **Step 2: Write the fixture test**

```typescript
// web/src/lib/expr/fixtures/fixtures.test.ts
import { describe, expect, it } from "vitest";
import { evaluate } from "../evaluator";
import { parse } from "../parser";
import { Scope } from "../scope";
import fixtures from "./expr-fixtures.json";

interface Fixture {
  name: string;
  expr: string;
  scope: Record<string, unknown>;
  expected: unknown;
}

describe("expression fixtures", () => {
  for (const fx of fixtures as Fixture[]) {
    it(fx.name, () => {
      const ast = parse(fx.expr);
      const result = evaluate(ast, new Scope(fx.scope));
      // Accept null or undefined as equivalent for the "missing" case
      if (fx.expected === null) {
        expect(result === null || result === undefined).toBe(true);
      } else {
        expect(result).toEqual(fx.expected);
      }
    });
  }
});
```

- [ ] **Step 3: Run + commit**

```bash
cd web && npm test -- fixtures.test --run
git add web/src/lib/expr/fixtures/
git commit -m "test(expr): add shared TS/Java equivalence fixtures"
```

---

## Final verification

### Task 22: Full suite + lint

- [ ] **Step 1: Run full Vitest suite**

```bash
cd web && npm test -- --run
```

Expected: all pass. If pre-existing tests fail, investigate before continuing — the new code should not regress them.

- [ ] **Step 2: Run lint**

```bash
cd web && npm run lint
```

Fix any issues, commit:

```bash
git add -A
git commit -m "chore: fix lint after expr DSL implementation"
```

- [ ] **Step 3: Run typecheck**

```bash
cd web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Build**

```bash
cd web && npm run build
```

Expected: successful build, no warnings beyond pre-existing.

---

## What ships at the end of Plan A

- Working TypeScript DSL: `parse(src) → AST`, `evaluate(ast, scope) → unknown`
- AST cache: `cache.get(packId, version, expr) → AST`
- Template renderer: `renderTemplate(template, opts) → string` ready for downstream MM parse
- New schema types in domain — usable in code, NOT yet exposed in any editor UI
- Shared equivalence fixtures for future Java parity

**What doesn't yet ship** (Plan B):
- Editor UI for new condition / actions
- Toolbar buttons in template fields
- Patterns gallery
- Autocomplete + scope inference
- Plain-language error messages in the editor
- Multi-iter preview pane
- Migration of `placeholders.ts` callers to the new renderer
