import type { AstNode } from "./ast";
import { ParseError } from "./errors";
import { tokenize } from "./lexer";
import type { Token, TokenKind } from "./token";

class Parser {
  private i = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    // The lexer always appends an eof token, so tokens[i] is always defined
    // as long as we don't advance past eof. We assert non-null here.
    return this.tokens[this.i]!;
  }

  private consume(kind: TokenKind, what?: string): Token {
    const t = this.tokens[this.i]!;
    if (t.kind !== kind) {
      throw new ParseError(
        `Expected ${what ?? kind} but got '${t.text || t.kind}' at column ${t.pos}`,
        t.pos,
      );
    }
    this.i++;
    return t;
  }

  /** Consume and return the matched token if its kind is `kind`, otherwise null and no-op. */
  private match(kind: TokenKind): Token | null {
    const t = this.tokens[this.i]!;
    if (t.kind === kind) {
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

  // For now, ternary just delegates to postfix — we'll layer in operators in later tasks.
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

  private primary(): AstNode {
    const t = this.peek();

    if (
      t.kind === "number" ||
      t.kind === "string" ||
      t.kind === "true" ||
      t.kind === "false" ||
      t.kind === "null"
    ) {
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
