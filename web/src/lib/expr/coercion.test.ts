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
    expect(compare("5", "10", "<")).toBe(true);
  });
  it("compares strings lexicographically when not both numeric", () => {
    expect(compare("a", "b", "<")).toBe(true);
    expect(compare("b", "a", ">")).toBe(true);
  });
  it("treats null as 0 when other side is numeric", () => {
    expect(compare(null, 5, "<")).toBe(true);
  });
});
