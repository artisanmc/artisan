import { describe, expect, test } from "bun:test";
import { hashPassword, verifyPassword } from "./passwordHasher";

describe("hashPassword", () => {
  test("returns non-empty string", async () => {
    const hash = await hashPassword("hunter2");
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(20);
  });

  test("two calls on same input produce different hashes (salt)", async () => {
    const h1 = await hashPassword("hunter2");
    const h2 = await hashPassword("hunter2");
    expect(h1).not.toBe(h2);
  });
});

describe("verifyPassword", () => {
  test("verifies the correct password", async () => {
    const hash = await hashPassword("hunter2");
    expect(await verifyPassword("hunter2", hash)).toBe(true);
  });

  test("rejects an incorrect password", async () => {
    const hash = await hashPassword("hunter2");
    expect(await verifyPassword("hunter3", hash)).toBe(false);
  });

  test("rejects on garbage hash without throwing", async () => {
    expect(await verifyPassword("hunter2", "not-a-hash")).toBe(false);
  });
});
