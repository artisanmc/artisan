import type { PlaceholderType } from "@/lib/placeholderCatalog";
import type { AstNode } from "./ast";
import { parse } from "./parser";
import { printExpression } from "./print";
import { quoteText } from "./readable";

/**
 * The expressions a non-coder builds from a sentence ("show a text if…"): each recipe
 * says which variables fit it and writes the `{…}` from what was filled in. The
 * result is plain source, read back as rules by the rich view.
 */
export type RecipeId = "showIf" | "yesNo" | "byNumber" | "count" | "join" | "timeAgo" | "timeLeft";

export type CompareOp = ">=" | ">" | "<" | "<=" | "==";

export interface RecipeInput {
  /** The variable's path, braces left out. */
  path: string;
  /** showIf: show when the variable is false instead. */
  negate?: boolean;
  /** showIf / yesNo / byNumber: shown when the condition holds. */
  text?: string;
  /** yesNo / byNumber: shown otherwise. */
  otherwise?: string;
  op?: CompareOp;
  /** byNumber: the number compared to. */
  value?: number;
  /** join: between two items. */
  separator?: string;
}

export interface Recipe {
  id: RecipeId;
  /** The variables it can read. */
  accepts: PlaceholderType[];
  /** Narrows `accepts` by the variable's name (a date is a number or a text). */
  fits?: (path: string) => boolean;
  /** The fields its form asks for, beyond the variable. */
  fields: ("negate" | "text" | "otherwise" | "compare" | "separator")[];
  build: (input: RecipeInput) => string;
}

const q = (text = "") => quoteText(text);

/** A name that reads as a moment: `joined`, `last_seen`, `created_at`, `expires`… */
const DATE_NAME =
  /(^|[._])(date|time|at|since|seen|joined|created|updated|expires?|ends?|starts?|until)([._]|$)|_at$/i;
const isDate = (path: string) => DATE_NAME.test(path.split(".").pop() ?? path);

export const RECIPES: Recipe[] = [
  {
    id: "showIf",
    accepts: ["boolean"],
    fields: ["negate", "text"],
    build: ({ path, negate, text }) => `{${negate ? "!" : ""}${path} ? ${q(text)} : ""}`,
  },
  {
    id: "yesNo",
    accepts: ["boolean"],
    fields: ["text", "otherwise"],
    build: ({ path, text, otherwise }) => `{${path} ? ${q(text)} : ${q(otherwise)}}`,
  },
  {
    id: "byNumber",
    accepts: ["integer", "number"],
    fields: ["compare", "text", "otherwise"],
    build: ({ path, op = ">=", value = 0, text, otherwise }) =>
      `{${path} ${op} ${Number.isFinite(value) ? value : 0} ? ${q(text)} : ${q(otherwise)}}`,
  },
  {
    id: "count",
    accepts: ["list"],
    fields: [],
    build: ({ path }) => `{${path}.length()}`,
  },
  {
    id: "join",
    accepts: ["list"],
    fields: ["separator"],
    build: ({ path, separator = ", " }) => `{${path}.join(${q(separator)})}`,
  },
  {
    id: "timeAgo",
    accepts: ["integer", "number", "string"],
    fits: isDate,
    fields: [],
    build: ({ path }) => `{${path}.ago()}`,
  },
  {
    id: "timeLeft",
    accepts: ["integer", "number", "string"],
    fits: isDate,
    fields: [],
    build: ({ path }) => `{${path}.until()}`,
  },
];

/** The variables a recipe can read, in the catalog's order; method paths left out. */
export function recipeVariables<E extends { path: string; type: PlaceholderType }>(
  recipe: Recipe,
  entries: E[],
): E[] {
  const seen = new Set<string>();
  return entries.filter((e) => {
    if (seen.has(e.path) || /[()[\]]/.test(e.path)) return false;
    if (!recipe.accepts.includes(e.type) || (recipe.fits && !recipe.fits(e.path))) return false;
    seen.add(e.path);
    return true;
  });
}

/**
 * The recipe a `{…}` (inner text) was built from, with what was filled in, so the
 * form opens again on it; null for anything else.
 */
export function matchRecipe(inner: string): { recipe: Recipe; input: RecipeInput } | null {
  let ast: AstNode;
  try {
    ast = parse(inner);
  } catch {
    return null;
  }
  const found = (id: RecipeId, input: RecipeInput) => ({
    recipe: RECIPES.find((r) => r.id === id)!,
    input,
  });
  const path = (n: AstNode) => (/^[\w.]+$/.test(printExpression(n)) ? printExpression(n) : null);
  const str = (n: AstNode) =>
    n.kind === "literal" && typeof n.value === "string" ? n.value : null;
  if (ast.kind === "ternary") {
    const yes = str(ast.whenTrue);
    const no = str(ast.whenFalse);
    if (yes === null || no === null) return null;
    const c = ast.cond;
    if (c.kind === "binary" && OPS.includes(c.op as CompareOp)) {
      const p = path(c.left);
      if (p && c.right.kind === "literal" && typeof c.right.value === "number")
        return found("byNumber", {
          path: p,
          op: c.op as CompareOp,
          value: c.right.value,
          text: yes,
          otherwise: no,
        });
      return null;
    }
    const negate = c.kind === "unary";
    const p = path(negate ? (c as AstNode & { kind: "unary" }).operand : c);
    if (!p) return null;
    if (no === "") return found("showIf", { path: p, negate, text: yes });
    if (!negate) return found("yesNo", { path: p, text: yes, otherwise: no });
    return null;
  }
  if (ast.kind === "method") {
    const p = path(ast.target);
    if (!p) return null;
    const ids: Record<string, RecipeId> = {
      length: "count",
      join: "join",
      ago: "timeAgo",
      until: "timeLeft",
    };
    const id = ids[ast.method];
    if (!id) return null;
    const sep = ast.args[0] ? str(ast.args[0]) : null;
    if (id === "join") return sep === null ? null : found("join", { path: p, separator: sep });
    return ast.args.length === 0 ? found(id, { path: p }) : null;
  }
  return null;
}

const OPS: CompareOp[] = [">=", ">", "<", "<=", "=="];
