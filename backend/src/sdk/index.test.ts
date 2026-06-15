import { describe, expect, test } from "bun:test";
import * as sdk from "@artisan/backend-sdk";

describe("@artisan/backend-sdk public surface", () => {
  test("exposes the module-system integrator", () => {
    expect(typeof sdk.mountModules).toBe("function");
  });
});
