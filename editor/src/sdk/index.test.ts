import { describe, expect, it } from "vitest";
import * as sdk from "@artisan/editor-sdk";

describe("@artisan/editor-sdk public surface", () => {
  it("exposes the module-system contract", () => {
    expect(typeof sdk.registerModule).toBe("function");
    expect(typeof sdk.listModules).toBe("function");
    expect(typeof sdk.getModule).toBe("function");
    expect(typeof sdk.onModuleEvent).toBe("function");
    expect(typeof sdk.emitModuleEvent).toBe("function");
  });

  it("does not leak test-only helpers", () => {
    expect("clearRegistry" in sdk).toBe(false);
    expect("clearModuleBus" in sdk).toBe(false);
  });
});
