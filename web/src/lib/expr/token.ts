export type TokenKind =
  | "number" // 42, 3.14
  | "string" // "hi" or 'hi'
  | "identifier" // foo, foo_bar
  | "papi" // %player_name%
  | "true"
  | "false"
  | "null"
  | "lparen" // (
  | "rparen" // )
  | "lbracket" // [
  | "rbracket" // ]
  | "comma"
  | "dot"
  | "question" // ?
  | "colon" // :
  | "bang" // !
  | "plus"
  | "minus"
  | "eq" // ==
  | "neq" // !=
  | "lt"
  | "lte"
  | "gt"
  | "gte"
  | "and" // &&
  | "or" // ||
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
