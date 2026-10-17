import * as sdk from "@artisan/editor-sdk";
import { describe, expect, it } from "vitest";

describe("@artisan/editor-sdk public surface", () => {
  it("exposes the module-system contract", () => {
    expect(typeof sdk.registerModule).toBe("function");
    expect(typeof sdk.listModules).toBe("function");
    expect(typeof sdk.getModule).toBe("function");
    expect(typeof sdk.onModuleEvent).toBe("function");
    expect(typeof sdk.emitModuleEvent).toBe("function");
    expect(typeof sdk.selectDocumentItem).toBe("function");
  });

  it("exposes shared base primitives", () => {
    expect(sdk.Button).toBeDefined();
    expect(typeof sdk.ActionChainEditor).toBe("function");
    expect(typeof sdk.MaterialInput).toBe("function");
    expect(typeof sdk.ItemInput).toBe("function");
    expect(typeof sdk.cn).toBe("function");
  });

  it("does not leak test-only helpers", () => {
    expect("clearRegistry" in sdk).toBe(false);
    expect("clearModuleBus" in sdk).toBe(false);
  });
});
