import { describe, expect, it } from "bun:test";
import { can } from "./capabilities";

describe("capabilities", () => {
  it("owner and legacy admin can everything", () => {
    for (const cap of ["edit_content", "manage_servers", "manage_members", "manage_billing", "transfer_network", "delete_network"] as const) {
      expect(can("owner", cap)).toBe(true);
      expect(can("admin", cap)).toBe(true);
    }
  });
  it("member can only edit content", () => {
    expect(can("member", "edit_content")).toBe(true);
    expect(can("member", "manage_members")).toBe(false);
    expect(can("member", "manage_servers")).toBe(false);
    expect(can("member", "delete_network")).toBe(false);
  });
  it("unknown role can nothing", () => {
    expect(can("wizard", "edit_content")).toBe(false);
  });
});
