/**
 * Convert a raw ParseError message into an i18n key + interpolation
 * params. Patterns mirror the messages thrown from `lexer.ts` and
 * `parser.ts`. Unknown shapes fall back to a generic "raw" key so
 * users still see something useful.
 */

export interface FormattedError {
  key: string;
  params: Record<string, string>;
}

const PATTERNS: Array<{
  re: RegExp;
  key: string;
  map: (m: RegExpMatchArray) => Record<string, string>;
}> = [
  {
    re: /^Unexpected character '(.+)' at column (\d+)$/,
    key: "conditions.parseError.unexpectedChar",
    map: (m) => ({ char: m[1] ?? "", col: m[2] ?? "" }),
  },
  {
    re: /^Unterminated string starting at column (\d+)$/,
    key: "conditions.parseError.unterminatedString",
    map: (m) => ({ col: m[1] ?? "" }),
  },
  {
    re: /^Unterminated PAPI placeholder starting at column (\d+)$/,
    key: "conditions.parseError.unterminatedPapi",
    map: (m) => ({ col: m[1] ?? "" }),
  },
  {
    re: /^Invalid PAPI placeholder at column (\d+)/,
    key: "conditions.parseError.invalidPapi",
    map: (m) => ({ col: m[1] ?? "" }),
  },
  {
    re: /^Expected (.+) but got (.+) at column (\d+)$/,
    key: "conditions.parseError.expected",
    map: (m) => ({ expected: m[1] ?? "", got: m[2] ?? "", col: m[3] ?? "" }),
  },
  {
    re: /^Unexpected token (.+) at column (\d+)$/,
    key: "conditions.parseError.unexpectedToken",
    map: (m) => ({ token: m[1] ?? "", col: m[2] ?? "" }),
  },
  {
    re: /^Empty expression$/,
    key: "conditions.parseError.empty",
    map: () => ({}),
  },
];

export function formatParseError(message: string): FormattedError {
  for (const { re, key, map } of PATTERNS) {
    const m = message.match(re);
    if (m) return { key, params: map(m) };
  }
  return { key: "conditions.parseError.raw", params: { message } };
}
