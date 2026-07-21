/**
 * Action DSL lexer. Cf. ADR `action-dsl`. Splits source into logical lines
 * (blank + `#`-comment lines dropped) carrying their indentation depth and a
 * flat token list. Indentation is significant (block structure); a trailing
 * `:` on a header line becomes a COLON token. The parser consumes these.
 */

export type TokenType =
  | "word" // identifier / keyword / enum / material / sound / world
  | "number"
  | "string" // "..." literal (quotes stripped, escapes resolved)
  | "key" // @some.key
  | "papi" // %placeholder%
  | "op" // = == != <= >= < > ( ) , + -
  | "colon"; // trailing : opening a block

export interface Token {
  type: TokenType;
  value: string;
  col: number;
}

export interface LogicalLine {
  indent: number;
  tokens: Token[];
  line: number; // 1-based source line, for errors
}

export class DslLexError extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly col: number,
  ) {
    super(`${message} (line ${line}, col ${col})`);
    this.name = "DslLexError";
  }
}

// Dots allowed inside words so expression paths (`alias.field`) lex as one token.
const WORD_RE = /[A-Za-z_][A-Za-z0-9_.]*/y;
const NUMBER_RE = /[0-9]+(?:\.[0-9]+)?/y;
const KEY_RE = /@[A-Za-z0-9_][A-Za-z0-9_.]*/y;
const PAPI_RE = /%[A-Za-z_][A-Za-z0-9_]*%/y;

const TWO_CHAR_OPS = new Set(["==", "!=", "<=", ">="]);
const ONE_CHAR_OPS = new Set(["=", "<", ">", "(", ")", ",", "+", "-"]);

export function lex(source: string): LogicalLine[] {
  const out: LogicalLine[] = [];
  const rawLines = source.replace(/\r\n?/g, "\n").split("\n");
  rawLines.forEach((raw, i) => {
    const lineNo = i + 1;
    const indent = raw.length - raw.trimStart().length;
    const content = stripComment(raw, lineNo);
    if (content.trim() === "") return; // blank / comment-only
    const tokens = tokenizeLine(content, lineNo);
    if (tokens.length > 0) out.push({ indent, tokens, line: lineNo });
  });
  return out;
}

/** Remove a `#` comment, honoring `"..."` strings so `#` inside text survives. */
function stripComment(raw: string, _line: number): string {
  let inStr = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '"' && raw[i - 1] !== "\\") inStr = !inStr;
    else if (c === "#" && !inStr) return raw.slice(0, i);
  }
  return raw;
}

function tokenizeLine(content: string, line: number): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = content.length;
  while (i < n) {
    const c = content[i]!;
    if (c === " " || c === "\t") {
      i++;
      continue;
    }
    if (c === ":" && content.slice(i + 1).trim() === "") {
      tokens.push({ type: "colon", value: ":", col: i + 1 });
      i = n;
      break;
    }
    if (c === '"') {
      const { value, next } = readString(content, i, line);
      tokens.push({ type: "string", value, col: i + 1 });
      i = next;
      continue;
    }
    if (c === "@") {
      KEY_RE.lastIndex = i;
      const m = KEY_RE.exec(content);
      if (!m) throw new DslLexError("Malformed @key", line, i + 1);
      tokens.push({ type: "key", value: m[0].slice(1), col: i + 1 });
      i = KEY_RE.lastIndex;
      continue;
    }
    if (c === "%") {
      PAPI_RE.lastIndex = i;
      const m = PAPI_RE.exec(content);
      if (!m) throw new DslLexError("Malformed %placeholder%", line, i + 1);
      tokens.push({ type: "papi", value: m[0], col: i + 1 });
      i = PAPI_RE.lastIndex;
      continue;
    }
    if (c >= "0" && c <= "9") {
      NUMBER_RE.lastIndex = i;
      const m = NUMBER_RE.exec(content);
      if (m) {
        tokens.push({ type: "number", value: m[0], col: i + 1 });
        i = NUMBER_RE.lastIndex;
        continue;
      }
    }
    const two = content.slice(i, i + 2);
    if (TWO_CHAR_OPS.has(two)) {
      tokens.push({ type: "op", value: two, col: i + 1 });
      i += 2;
      continue;
    }
    if (ONE_CHAR_OPS.has(c)) {
      tokens.push({ type: "op", value: c, col: i + 1 });
      i++;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      WORD_RE.lastIndex = i;
      const m = WORD_RE.exec(content);
      if (m) {
        tokens.push({ type: "word", value: m[0], col: i + 1 });
        i = WORD_RE.lastIndex;
        continue;
      }
    }
    throw new DslLexError(`Unexpected character '${c}'`, line, i + 1);
  }
  return tokens;
}

function readString(content: string, start: number, line: number): { value: string; next: number } {
  let out = "";
  let i = start + 1;
  while (i < content.length) {
    const c = content[i];
    if (c === "\\") {
      const nxt = content[i + 1];
      out += nxt === "n" ? "\n" : nxt === "t" ? "\t" : (nxt ?? "");
      i += 2;
      continue;
    }
    if (c === '"') return { value: out, next: i + 1 };
    out += c;
    i++;
  }
  throw new DslLexError("Unterminated string", line, start + 1);
}
