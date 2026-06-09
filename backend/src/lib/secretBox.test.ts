import { describe, expect, it, beforeAll } from "bun:test";
import { encryptSecret, decryptSecret, isSecretsConfigured } from "./secretBox";

beforeAll(() => { process.env.CONFIG_ENC_KEY = "0".repeat(64); }); // 32 bytes hex

describe("secretBox", () => {
  it("round-trips a secret", () => {
    const ct = encryptSecret("sk-12345");
    expect(ct).not.toContain("sk-12345");
    expect(decryptSecret(ct)).toBe("sk-12345");
  });
  it("uses a fresh iv each time (ciphertext differs)", () => {
    expect(encryptSecret("x")).not.toBe(encryptSecret("x"));
  });
  it("fails to decrypt tampered ciphertext", () => {
    const ct = encryptSecret("secret");
    const parts = ct.split(":");
    const tampered = [parts[0], parts[1], Buffer.from("zzzz").toString("base64")].join(":");
    expect(() => decryptSecret(tampered)).toThrow();
  });
  it("isSecretsConfigured reflects CONFIG_ENC_KEY", () => {
    expect(isSecretsConfigured()).toBe(true);
  });
});
