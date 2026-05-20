import { describe, expect, test } from "bun:test";
import { normalizeEmail } from "./emailNormalizer";

describe("normalizeEmail", () => {
  test("lowercases", () => {
    expect(normalizeEmail("User@Example.COM")).toBe("user@example.com");
  });

  test("trims surrounding whitespace", () => {
    expect(normalizeEmail("  alice@example.com  ")).toBe("alice@example.com");
  });

  test("preserves the local part as-is otherwise", () => {
    expect(normalizeEmail("alice+tag@example.com")).toBe("alice+tag@example.com");
  });
});
