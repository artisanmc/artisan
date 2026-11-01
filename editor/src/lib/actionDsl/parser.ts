import type { Condition, DialogId, ElementId, MenuId } from "@/domain/types";
import type { DslAction, DslIfCase, DslStep, DslText } from "./ast";
import { type LogicalLine, type Token, lex } from "./lexer";

/**
 * Action DSL parser. Cf. ADR `action-dsl`. `parseActionDsl(source)` → the pure
 * `DslStep[]` AST. Indentation drives block structure; each line is an action
 * verb or an `if`/`else if`/`else` header. Conditions parse to the domain's
 * typed {@link Condition} vocabulary, with free comparisons falling back to
 * `{type:"expression"}` and `%ph% ==/matches` to `placeholder_equals`/`_match`.
 */

export class DslParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly col?: number,
  ) {
    super(col ? `${message} (line ${line}, col ${col})` : `${message} (line ${line})`);
    this.name = "DslParseError";
  }
}

const PREDICATES = new Set([
  "has_permission",
  "has_money",
  "has_item",
  "has_xp",
  "has_level",
  "world_is",
  "time_is",
  "random_chance",
  "cooldown_passed",
  "player_in_region",
  "has_var",
  "pagination_at_first",
  "pagination_at_last",
]);

export function parseActionDsl(source: string): DslStep[] {
  const lines = lex(source);
  if (lines.length === 0) return [];
  return new BlockParser(lines).parseBlock(lines[0]!.indent);
}

class BlockParser {
  private pos = 0;
  constructor(private lines: LogicalLine[]) {}

  private peek(): LogicalLine | undefined {
    return this.lines[this.pos];
  }

  parseBlock(indent: number): DslStep[] {
    const steps: DslStep[] = [];
    while (this.pos < this.lines.length) {
      const line = this.lines[this.pos]!;
      if (line.indent < indent) break;
      if (line.indent > indent) {
        throw new DslParseError("Unexpected indentation", line.line);
      }
      const head = line.tokens[0]!;
      if (head.type === "word" && head.value === "if") {
        steps.push(this.parseIf(indent));
      } else if (head.type === "word" && (head.value === "else" || head.value === "elif")) {
        break; // handled by the enclosing parseIf
      } else {
        this.pos++;
        steps.push({ kind: "action", action: parseActionLine(line) });
      }
    }
    return steps;
  }

  private parseIf(indent: number): DslStep {
    const cases: DslIfCase[] = [];
    let elseSteps: DslStep[] | undefined;

    // `if <cond>:`
    const first = this.lines[this.pos]!;
    this.pos++;
    cases.push(this.readCase(first, 1, indent));

    while (this.pos < this.lines.length) {
      const line = this.lines[this.pos]!;
      if (line.indent !== indent) break;
      const t0 = line.tokens[0]!;
      const isElse = t0.type === "word" && t0.value === "else";
      if (!isElse) break;
      const t1 = line.tokens[1];
      if (t1 && t1.type === "word" && t1.value === "if") {
        this.pos++;
        cases.push(this.readCase(line, 2, indent));
      } else {
        // bare `else:`
        this.pos++;
        elseSteps = this.parseBlock(this.childIndent(indent, line));
        break;
      }
    }

    return { kind: "if", cases, ...(elseSteps ? { else: elseSteps } : {}) };
  }

  /** Read one if/else-if arm: condition tokens (after `condStart`) + child block. */
  private readCase(header: LogicalLine, condStart: number, indent: number): DslIfCase {
    const toks = header.tokens;
    if (toks[toks.length - 1]!.type !== "colon") {
      throw new DslParseError("Expected ':' to open an if block", header.line);
    }
    const condToks = toks.slice(condStart, toks.length - 1);
    if (condToks.length === 0) {
      throw new DslParseError("Empty condition", header.line);
    }
    const { conditions, joins } = new CondParser(condToks, header.line).parseFlat();
    const steps = this.parseBlock(this.childIndent(indent, header));
    return { conditions, ...(joins ? { joins } : {}), steps };
  }

  private childIndent(parentIndent: number, header: LogicalLine): number {
    const next = this.peek();
    if (!next || next.indent <= parentIndent) {
      throw new DslParseError("Expected an indented block", header.line);
    }
    return next.indent;
  }
}

// Action lines

function parseActionLine(line: LogicalLine): DslAction {
  const c = new LineCursor(line.tokens, line.line);
  const verb = c.word();
  const a = parseVerb(verb, c);
  c.end();
  return a;
}

function parseVerb(verb: string, c: LineCursor): DslAction {
  switch (verb) {
    case "broadcast":
      return { type: "broadcast", text: c.text() };
    case "send_message":
      return { type: "send_message", text: c.text() };
    case "give_item":
      return { type: "give_item", material: c.word(), count: c.int() };
    case "take_item":
      return { type: "take_item", material: c.word(), count: c.int() };
    case "give_money":
      return { type: "give_money", amount: c.num() };
    case "take_money":
      return { type: "take_money", amount: c.num() };
    case "give_xp":
      return { type: "give_xp", amount: c.int() };
    case "give_level":
      return { type: "give_level", amount: c.int() };
    case "run_command": {
      const command = c.rawString();
      c.keyword("as");
      const as = c.oneOf("player", "console") as "player" | "console";
      return { type: "run_command", command, as };
    }
    case "play_sound": {
      const sound = c.word();
      const kw = c.keywords({ vol: "num", pitch: "num" });
      return {
        type: "play_sound",
        sound,
        ...(kw.vol !== undefined ? { volume: kw.vol as number } : {}),
        ...(kw.pitch !== undefined ? { pitch: kw.pitch as number } : {}),
      };
    }
    case "teleport": {
      const world = c.word();
      const x = c.num();
      const y = c.num();
      const z = c.num();
      const kw = c.keywords({ yaw: "num", pitch: "num" });
      return {
        type: "teleport",
        world,
        x,
        y,
        z,
        ...(kw.yaw !== undefined ? { yaw: kw.yaw as number } : {}),
        ...(kw.pitch !== undefined ? { pitch: kw.pitch as number } : {}),
      };
    }
    case "show_title": {
      const title = c.text();
      const subtitle = c.optText();
      const kw = c.keywords({ fadeIn: "num", stay: "num", fadeOut: "num" });
      return {
        type: "show_title",
        title,
        ...(subtitle ? { subtitle } : {}),
        ...(kw.fadeIn !== undefined ? { fadeIn: kw.fadeIn as number } : {}),
        ...(kw.stay !== undefined ? { stay: kw.stay as number } : {}),
        ...(kw.fadeOut !== undefined ? { fadeOut: kw.fadeOut as number } : {}),
      };
    }
    case "open_menu":
      return { type: "open_menu", menuId: c.word() as MenuId, ...c.menuTail() };
    case "open_dialog":
      return { type: "open_dialog", dialogId: c.word() as DialogId, ...c.menuTail() };
    case "close_menu":
      return { type: "close_menu" };
    case "close_dialog":
      return { type: "close_dialog" };
    case "open_previous_menu":
      return { type: "open_previous_menu" };
    case "paginate": {
      const direction = c.oneOf("next", "prev") as "next" | "prev";
      const targetElementId = c.optWord() as ElementId | undefined;
      return { type: "paginate", direction, ...(targetElementId ? { targetElementId } : {}) };
    }
    case "run_actions":
      return { type: "run_actions", actions: c.exprRest() };
    case "set": {
      const arg = c.word();
      c.op("=");
      return { type: "set_arg", arg, value: c.exprRest() };
    }
    case "cycle": {
      const direction = c.optOneOf("next", "prev") ?? "next";
      const arg = c.word();
      c.keyword("in");
      const list = c.exprRest();
      return direction === "prev"
        ? { type: "set_arg_cycle_prev", arg, list }
        : { type: "set_arg_cycle_next", arg, list };
    }
    default:
      throw new DslParseError(`Unknown action '${verb}'`, c.line, 1);
  }
}

// Conditions

class CondParser {
  private pos = 0;
  constructor(
    private toks: Token[],
    private line: number,
  ) {}

  private peek(): Token | undefined {
    return this.toks[this.pos];
  }
  private next(): Token {
    const t = this.toks[this.pos];
    if (!t) throw new DslParseError("Unexpected end of condition", this.line);
    this.pos++;
    return t;
  }
  private isWord(v: string): boolean {
    const t = this.peek();
    return !!t && t.type === "word" && t.value === v;
  }
  private isOp(v: string): boolean {
    const t = this.peek();
    return !!t && t.type === "op" && t.value === v;
  }

  /** Top level of an `if`: flat conditions + joins (precedence applied at eval). */
  parseFlat(): { conditions: Condition[]; joins?: ("and" | "or")[] } {
    const conditions: Condition[] = [this.parseAtom()];
    const joins: ("and" | "or")[] = [];
    while (this.isWord("and") || this.isWord("or")) {
      joins.push(this.next().value as "and" | "or");
      conditions.push(this.parseAtom());
    }
    if (this.peek()) throw new DslParseError("Unexpected token in condition", this.line);
    return { conditions, ...(joins.length ? { joins } : {}) };
  }

  /** Inside parentheses: precedence-aware, returns one (possibly composite) condition. */
  private parseGrouped(): Condition {
    return this.parseOr();
  }
  private parseOr(): Condition {
    const of: Condition[] = [this.parseAnd()];
    while (this.isWord("or")) {
      this.next();
      of.push(this.parseAnd());
    }
    return of.length > 1 ? { type: "or", of } : of[0]!;
  }
  private parseAnd(): Condition {
    const of: Condition[] = [this.parseAtom()];
    while (this.isWord("and")) {
      this.next();
      of.push(this.parseAtom());
    }
    return of.length > 1 ? { type: "and", of } : of[0]!;
  }

  private parseAtom(): Condition {
    if (this.isWord("not")) {
      this.next();
      return { type: "not", of: this.parseAtom() };
    }
    if (this.isOp("(")) {
      this.next();
      const c = this.parseGrouped();
      if (!this.isOp(")")) throw new DslParseError("Expected ')'", this.line);
      this.next();
      return c;
    }
    const t = this.peek();
    if (t && t.type === "word" && PREDICATES.has(t.value)) {
      return this.parsePredicate();
    }
    return this.parseComparison();
  }

  private parsePredicate(): Condition {
    const name = this.next().value;
    const args: Token[] = [];
    if (this.isOp("(")) {
      this.next();
      while (!this.isOp(")")) {
        args.push(this.next());
        if (this.isOp(",")) this.next();
      }
      this.next(); // )
    }
    const argVals = args.filter((a) => a.type !== "op");
    const str = (i: number): string => {
      const a = argVals[i];
      if (!a) throw new DslParseError(`${name} missing argument ${i + 1}`, this.line);
      return a.value;
    };
    const num = (i: number): number => Number(str(i));
    switch (name) {
      case "has_permission":
        return { type: "has_permission", perm: str(0) };
      case "has_money":
        return { type: "has_money", amount: num(0) };
      case "has_item":
        return { type: "has_item", material: str(0), count: num(1) };
      case "has_xp":
        return { type: "has_xp", amount: num(0) };
      case "has_level":
        return { type: "has_level", level: num(0) };
      case "world_is":
        return { type: "world_is", world: str(0) };
      case "random_chance":
        return { type: "random_chance", probability: num(0) };
      case "cooldown_passed":
        return { type: "cooldown_passed", cooldown_id: str(0) };
      case "player_in_region":
        return { type: "player_in_region", region: str(0) };
      case "has_var":
        return { type: "has_var", var: str(0) };
      case "time_is": {
        const v = str(0);
        if (v === "day" || v === "night") return { type: "time_is", range: v };
        // A tick window lexes as `num - num`; reassemble from the RAW arg tokens
        // (`args`, which keeps the `-` op) — `argVals` has dropped it.
        const raw = args.map((a) => a.value).join("");
        const mm = /^(\d+)-(\d+)$/.exec(raw);
        if (!mm) throw new DslParseError("time_is expects day|night|<from>-<to>", this.line);
        return { type: "time_is", range: { from_ticks: Number(mm[1]), to_ticks: Number(mm[2]) } };
      }
      case "pagination_at_first":
        return { type: "pagination_at_first", ...(argVals[0] ? { elementId: str(0) } : {}) };
      case "pagination_at_last":
        return { type: "pagination_at_last", ...(argVals[0] ? { elementId: str(0) } : {}) };
      default:
        throw new DslParseError(`Unknown predicate '${name}'`, this.line);
    }
  }

  /** A comparison / free expression atom, up to the next top-level and/or/) . */
  private parseComparison(): Condition {
    const run: Token[] = [];
    let depth = 0;
    while (this.peek()) {
      const t = this.peek()!;
      if (depth === 0 && t.type === "word" && (t.value === "and" || t.value === "or")) break;
      if (depth === 0 && t.type === "op" && t.value === ")") break;
      if (t.type === "op" && t.value === "(") depth++;
      if (t.type === "op" && t.value === ")") depth--;
      run.push(this.next());
    }
    if (run.length === 0) throw new DslParseError("Expected a condition", this.line);
    // %ph% == "value"  →  placeholder_equals ; %ph% matches "re" → placeholder_match
    if (run.length === 3 && run[0]!.type === "papi" && run[2]!.type === "string") {
      if (run[1]!.type === "op" && run[1]!.value === "==") {
        return { type: "placeholder_equals", placeholder: run[0]!.value, value: run[2]!.value };
      }
      if (run[1]!.type === "word" && run[1]!.value === "matches") {
        return { type: "placeholder_match", placeholder: run[0]!.value, regex: run[2]!.value };
      }
    }
    return { type: "expression", expr: exprSource(run) };
  }
}

// Shared helpers

/** Canonical reconstruction of an expression token run (single-spaced ops). */
export function exprSource(toks: Token[]): string {
  let out = "";
  toks.forEach((t, i) => {
    const v = t.type === "string" ? JSON.stringify(t.value) : t.value;
    const prev = toks[i - 1];
    const noLeadSpace =
      i === 0 || (t.type === "op" && (t.value === ")" || t.value === "," || t.value === "("));
    const prevNoTrail = !prev || (prev.type === "op" && prev.value === "(");
    out += noLeadSpace || prevNoTrail ? v : ` ${v}`;
    // keep `,` glued to previous, space after handled next iter
  });
  return out.replace(/\( /g, "(").replace(/ \)/g, ")").replace(/ ,/g, ",");
}

class LineCursor {
  private pos = 0;
  constructor(
    private toks: Token[],
    readonly line: number,
  ) {}

  private peek(): Token | undefined {
    return this.toks[this.pos];
  }
  private nextTok(what: string): Token {
    const t = this.toks[this.pos];
    if (!t) throw new DslParseError(`Expected ${what}`, this.line);
    this.pos++;
    return t;
  }

  word(): string {
    const t = this.nextTok("an identifier");
    if (t.type !== "word")
      throw new DslParseError(`Expected an identifier, got '${t.value}'`, this.line, t.col);
    return t.value;
  }
  optWord(): string | undefined {
    const t = this.peek();
    if (t && t.type === "word") {
      this.pos++;
      return t.value;
    }
    return undefined;
  }
  num(): number {
    let sign = 1;
    if (this.peek()?.type === "op" && this.peek()!.value === "-") {
      this.pos++;
      sign = -1;
    }
    const t = this.nextTok("a number");
    if (t.type !== "number")
      throw new DslParseError(`Expected a number, got '${t.value}'`, this.line, t.col);
    return sign * Number(t.value);
  }
  int(): number {
    return Math.round(this.num());
  }
  rawString(): string {
    const t = this.nextTok("a quoted string");
    if (t.type !== "string") throw new DslParseError("Expected a quoted string", this.line, t.col);
    return t.value;
  }
  text(): DslText {
    const t = this.nextTok("text or @key");
    if (t.type === "string") return { lit: t.value };
    if (t.type === "key") return { ref: t.value };
    throw new DslParseError(`Expected "text" or @key, got '${t.value}'`, this.line, t.col);
  }
  optText(): DslText | undefined {
    const t = this.peek();
    if (t && (t.type === "string" || t.type === "key")) return this.text();
    return undefined;
  }
  op(v: string): void {
    const t = this.nextTok(`'${v}'`);
    if (t.type !== "op" || t.value !== v)
      throw new DslParseError(`Expected '${v}'`, this.line, t.col);
  }
  keyword(v: string): void {
    const t = this.nextTok(`'${v}'`);
    if (t.type !== "word" || t.value !== v)
      throw new DslParseError(`Expected '${v}'`, this.line, t.col);
  }
  oneOf(...vals: string[]): string {
    const t = this.nextTok(vals.join("|"));
    if (t.type !== "word" || !vals.includes(t.value))
      throw new DslParseError(`Expected one of ${vals.join(", ")}`, this.line, t.col);
    return t.value;
  }
  optOneOf(...vals: string[]): string | undefined {
    const t = this.peek();
    if (t && t.type === "word" && vals.includes(t.value)) {
      this.pos++;
      return t.value;
    }
    return undefined;
  }

  /** Trailing `key=value` pairs (values are numbers here). Order-independent. */
  keywords(spec: Record<string, "num">): Record<string, number | undefined> {
    const out: Record<string, number | undefined> = {};
    while (this.peek()?.type === "word" && this.toks[this.pos + 1]?.value === "=") {
      const key = this.word();
      this.op("=");
      if (!(key in spec)) throw new DslParseError(`Unknown option '${key}'`, this.line);
      out[key] = this.num();
    }
    return out;
  }

  /** `[clear] [with k="v" ...]` tail shared by open_menu / open_dialog. */
  menuTail(): { clearContext?: boolean; context?: Record<string, string> } {
    const res: { clearContext?: boolean; context?: Record<string, string> } = {};
    if (this.peek()?.type === "word" && this.peek()!.value === "clear") {
      this.pos++;
      res.clearContext = true;
    }
    if (this.peek()?.type === "word" && this.peek()!.value === "with") {
      this.pos++;
      const context: Record<string, string> = {};
      while (this.peek()?.type === "word") {
        const key = this.word();
        this.op("=");
        context[key] = this.rawString();
      }
      res.context = context;
    }
    return res;
  }

  /** The rest of the line as a canonical expression string (set / cycle). */
  exprRest(): string {
    const rest = this.toks.slice(this.pos);
    this.pos = this.toks.length;
    if (rest.length === 0) throw new DslParseError("Expected an expression", this.line);
    return exprSource(rest);
  }

  end(): void {
    if (this.peek())
      throw new DslParseError(`Unexpected '${this.peek()!.value}'`, this.line, this.peek()!.col);
  }
}
