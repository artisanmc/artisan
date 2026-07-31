import { afterEach, describe, expect, it, vi } from "vitest";
import { getBillingBalance, getProjects, startPackCheckout } from "./billing";

const okJson = (body: unknown) => Promise.resolve({ ok: true, json: async () => body } as Response);

afterEach(() => vi.restoreAllMocks());

describe("billing client", () => {
  it("getProjects unwraps { projects }", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockReturnValue(okJson({ projects: [{ id: "p1" }] }) as never);
    expect(await getProjects()).toEqual([{ id: "p1" }]);
    expect(f.mock.calls[0][1]).toMatchObject({ credentials: "include" });
  });
  it("getBillingBalance sends networkId + returns breakdown", async () => {
    const f = vi
      .spyOn(globalThis, "fetch")
      .mockReturnValue(okJson({ total: 10, subscription: 5, rollover: 0, topup: 5 }) as never);
    const b = await getBillingBalance("net1");
    expect(b?.total).toBe(10);
    expect(String(f.mock.calls[0][0])).toContain("networkId=net1");
  });
  it("startPackCheckout returns the url, null on !ok", async () => {
    vi.spyOn(globalThis, "fetch").mockReturnValue(okJson({ url: "https://stripe/x" }) as never);
    expect(await startPackCheckout("net1", "p1")).toBe("https://stripe/x");
    vi.spyOn(globalThis, "fetch").mockReturnValue(Promise.resolve({ ok: false } as Response) as never);
    expect(await startPackCheckout("net1", "p1")).toBeNull();
  });
});
