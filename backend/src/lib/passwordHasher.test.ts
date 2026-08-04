import { describe, expect, test } from "bun:test";
import { hashPassword, verifyPassword } from "./passwordHasher";

// argon2id est volontairement coûteux (mémoire + CPU) : sous les 5 s par défaut,
// ces tests tombent dès qu'un autre fichier de la suite sature la machine — en
// pratique le téléchargement + extraction du JAR Mojang au premier run à froid,
// exactement l'état dans lequel la CI démarre.
const HASH_TIMEOUT_MS = 30_000;

describe("hashPassword", () => {
  test("returns non-empty string", async () => {
    const hash = await hashPassword("hunter2");
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(20);
  }, HASH_TIMEOUT_MS);

  test("two calls on same input produce different hashes (salt)", async () => {
    const h1 = await hashPassword("hunter2");
    const h2 = await hashPassword("hunter2");
    expect(h1).not.toBe(h2);
  }, HASH_TIMEOUT_MS);
});

describe("verifyPassword", () => {
  test("verifies the correct password", async () => {
    const hash = await hashPassword("hunter2");
    expect(await verifyPassword("hunter2", hash)).toBe(true);
  }, HASH_TIMEOUT_MS);

  test("rejects an incorrect password", async () => {
    const hash = await hashPassword("hunter2");
    expect(await verifyPassword("hunter3", hash)).toBe(false);
  }, HASH_TIMEOUT_MS);

  test("rejects on garbage hash without throwing", async () => {
    expect(await verifyPassword("hunter2", "not-a-hash")).toBe(false);
  }, HASH_TIMEOUT_MS);
});
