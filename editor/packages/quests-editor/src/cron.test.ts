import { describe, expect, it } from "vitest";
import { describeCron, isCronShape } from "./cron";

describe("describeCron", () => {
  it("says the common reset periods in words", () => {
    expect(describeCron("0 4 * * *", "fr")).toBe("tous les jours à 4 h");
    expect(describeCron("30 4 * * *", "en")).toBe("every day at 04:30");
    expect(describeCron("0 0 * * 1", "fr")).toBe("chaque lundi à 0 h");
    expect(describeCron("0 0 * * 7", "en")).toBe("every Sunday at 00:00");
    expect(describeCron("15 6 1 * *", "fr")).toBe("le 1er de chaque mois à 6 h 15");
    expect(describeCron("0 */6 * * *", "en")).toBe("every 6 hours, at minute 0");
    expect(describeCron("*/30 * * * *", "fr")).toBe("toutes les 30 minutes");
  });

  it("returns null for what it cannot say, and checks the shape", () => {
    expect(describeCron("0 4 * 1 *", "en")).toBeNull();
    expect(describeCron("0 4 1-5 * *", "en")).toBeNull();
    expect(describeCron("0 4 * *", "en")).toBeNull();
    expect(isCronShape("0 4 * * *")).toBe(true);
    expect(isCronShape("0 0 4 * * ?")).toBe(false);
  });
});
