import { describe, expect, it } from "bun:test";
import { issueTicket, redeemTicket, __resetTicketsForTests } from "./wsTickets";

describe("wsTickets", () => {
  it("issues and redeems one-shot", () => {
    __resetTicketsForTests();
    const t = issueTicket("user_1");
    expect(redeemTicket(t)).toEqual({ userId: "user_1" });
    expect(redeemTicket(t)).toBeNull(); // one-shot
  });
  it("expires after TTL", () => {
    __resetTicketsForTests();
    const t = issueTicket("user_1", /* nowMs */ 0);
    expect(redeemTicket(t, /* nowMs */ 31_000)).toBeNull();
  });
  it("unknown ticket → null", () => {
    expect(redeemTicket("nope")).toBeNull();
  });
});
