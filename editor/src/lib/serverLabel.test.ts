import { describe, it, expect } from "vitest";
import { displayServerLabel } from "./serverLabel";

describe("displayServerLabel", () => {
  it("returns the label when set", () => {
    expect(displayServerLabel({ id: "sk_abc123456789", label: "My Server" })).toBe("My Server");
  });

  it("trims whitespace from label", () => {
    expect(displayServerLabel({ id: "sk_abc123456789", label: "  My Server  " })).toBe("My Server");
  });

  it("falls back to 'Server <short>' when label is null", () => {
    expect(displayServerLabel({ id: "sk_abc123456789", label: null })).toBe("Server abc1");
  });

  it("falls back to 'Server <short>' when label is empty string", () => {
    expect(displayServerLabel({ id: "sk_abc123456789", label: "" })).toBe("Server abc1");
  });

  it("falls back to 'Server <short>' when label is whitespace-only", () => {
    expect(displayServerLabel({ id: "sk_abc123456789", label: "   " })).toBe("Server abc1");
  });

  it("falls back to 'Server <short>' when label is undefined", () => {
    expect(displayServerLabel({ id: "sk_abc123456789", label: undefined })).toBe("Server abc1");
  });

  it("uses first 4 chars for non-sk_ ids", () => {
    expect(displayServerLabel({ id: "abcd-efgh", label: null })).toBe("Server abcd");
  });

  it("uses chars 3-7 (4 chars) after sk_ prefix", () => {
    // "sk_XYZ1234..." → short = "XYZ1"
    expect(displayServerLabel({ id: "sk_XYZ1somemore", label: null })).toBe("Server XYZ1");
  });
});
