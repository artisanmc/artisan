import { describe, expect, it } from "bun:test";
import { issueTicket, redeemTicket, __resetTicketsForTests, __ticketCountForTests } from "./wsTickets";

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
  it("sweeps expired unredeemed tickets on next issue", () => {
    __resetTicketsForTests();
    const a = issueTicket("user_a", /* nowMs */ 0);
    expect(__ticketCountForTests()).toBe(1);

    // Issuing B well past A's TTL sweeps A before inserting B.
    const b = issueTicket("user_b", /* nowMs */ 40_000);
    expect(__ticketCountForTests()).toBe(1);

    expect(redeemTicket(a, 40_000)).toBeNull();
    expect(redeemTicket(b, 40_000)).toEqual({ userId: "user_b" });
  });
});
