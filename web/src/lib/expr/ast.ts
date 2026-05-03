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

export type BinaryOp = "+" | "-" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "&&" | "||";

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
