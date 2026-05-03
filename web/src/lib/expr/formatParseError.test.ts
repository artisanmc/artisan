import { describe, expect, it } from "vitest";
import { formatParseError } from "./formatParseError";

describe("formatParseError", () => {
  it("rewrites 'Unexpected character X at column N'", () => {
    expect(formatParseError("Unexpected character '@' at column 5")).toEqual({
      key: "conditions.parseError.unexpectedChar",
      params: { char: "@", col: "5" },
    });
  });

  it("rewrites 'Unterminated string starting at column N'", () => {
    expect(formatParseError("Unterminated string starting at column 4")).toEqual({
      key: "conditions.parseError.unterminatedString",
      params: { col: "4" },
    });
  });

  it("rewrites 'Unterminated PAPI placeholder starting at column N'", () => {
    expect(formatParseError("Unterminated PAPI placeholder starting at column 0")).toEqual({
      key: "conditions.parseError.unterminatedPapi",
      params: { col: "0" },
    });
  });

  it("rewrites 'Invalid PAPI placeholder at column N — expected ...'", () => {
    expect(
      formatParseError(
        "Invalid PAPI placeholder at column 0 — expected lowercase letter or underscore after %",
      ),
    ).toEqual({
      key: "conditions.parseError.invalidPapi",
      params: { col: "0" },
    });
  });

  it("rewrites 'Expected X but got Y at column N'", () => {
    expect(formatParseError("Expected ')' but got 'eof' at column 12")).toEqual({
      key: "conditions.parseError.expected",
      params: { expected: "')'", got: "'eof'", col: "12" },
    });
  });

  it("rewrites 'Unexpected token X at column N'", () => {
    expect(formatParseError("Unexpected token '!=' at column 7")).toEqual({
      key: "conditions.parseError.unexpectedToken",
      params: { token: "'!='", col: "7" },
    });
  });

  it("rewrites 'Empty expression'", () => {
    expect(formatParseError("Empty expression")).toEqual({
      key: "conditions.parseError.empty",
      params: {},
    });
  });

  it("falls back to raw message for unknown shapes", () => {
    expect(formatParseError("Some new error shape we didn't anticipate")).toEqual({
      key: "conditions.parseError.raw",
      params: { message: "Some new error shape we didn't anticipate" },
    });
  });
});
