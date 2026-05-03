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

/** Safe character accessor — returns "" when out of bounds. */
function char(src: string, i: number): string {
  return i < src.length ? (src[i] as string) : "";
}

export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = char(src, i);

    // whitespace
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // numbers
    if (isDigit(ch)) {
      const start = i;
      while (i < src.length && isDigit(char(src, i))) i++;
      if (char(src, i) === "." && isDigit(char(src, i + 1))) {
        i++;
        while (i < src.length && isDigit(char(src, i))) i++;
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
      while (i < src.length && char(src, i) !== quote) {
        if (char(src, i) === "\\" && i + 1 < src.length) {
          const next = char(src, i + 1);
          value += next === "n" ? "\n" : next === "t" ? "\t" : next;
          i += 2;
        } else {
          value += char(src, i);
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
      if (i >= src.length || !isLowerOrUnderscore(char(src, i))) {
        throw new ParseError(
          `Invalid PAPI placeholder at column ${start} — expected lowercase letter or underscore after %`,
          start,
        );
      }
      let name = "";
      while (i < src.length && isLowerAlphaNum(char(src, i))) {
        name += char(src, i);
        i++;
      }
      if (i >= src.length || char(src, i) !== "%") {
        throw new ParseError(`Unterminated PAPI placeholder starting at column ${start}`, start);
      }
      i++; // closing %
      out.push({ kind: "papi", text: src.slice(start, i), value: name, pos: start });
      continue;
    }

    // identifiers / keywords
    if (isAlpha(ch)) {
      const start = i;
      while (i < src.length && isAlphaNum(char(src, i))) i++;
      const text = src.slice(start, i);
      const kw: TokenKind | undefined = KEYWORDS[text];
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
    if (ch === "=" && char(src, i + 1) === "=") {
      out.push({ kind: "eq", text: "==", pos: i });
      i += 2;
      continue;
    }
    if (ch === "!" && char(src, i + 1) === "=") {
      out.push({ kind: "neq", text: "!=", pos: i });
      i += 2;
      continue;
    }
    if (ch === "<" && char(src, i + 1) === "=") {
      out.push({ kind: "lte", text: "<=", pos: i });
      i += 2;
      continue;
    }
    if (ch === ">" && char(src, i + 1) === "=") {
      out.push({ kind: "gte", text: ">=", pos: i });
      i += 2;
      continue;
    }
    if (ch === "&" && char(src, i + 1) === "&") {
      out.push({ kind: "and", text: "&&", pos: i });
      i += 2;
      continue;
    }
    if (ch === "|" && char(src, i + 1) === "|") {
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
    const single: TokenKind | undefined = SINGLE_CHAR[ch];
    if (single !== undefined) {
      out.push({ kind: single, text: ch, pos: i });
      i++;
      continue;
    }

    throw new ParseError(`Unexpected character '${ch}' at column ${i}`, i);
  }
  out.push({ kind: "eof", text: "", pos: src.length });
  return out;
}
