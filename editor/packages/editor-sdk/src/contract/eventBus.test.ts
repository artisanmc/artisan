import { beforeEach, describe, expect, it } from "vitest";
import { clearModuleBus, emitModuleEvent, onModuleEvent } from "./eventBus";

describe("editor module event bus", () => {
  beforeEach(() => clearModuleBus());

  it("delivers events to subscribers", () => {
    const seen: string[] = [];
    onModuleEvent("config_reload", (e) =>
      seen.push((e as { kind: "config_reload"; module_id: string }).module_id),
    );
    emitModuleEvent({ kind: "config_reload", module_id: "menus" });
    expect(seen).toEqual(["menus"]);
  });

  it("does not deliver to subscribers of other kinds", () => {
    const seen: string[] = [];
    onModuleEvent("data_reload", (e) =>
      seen.push((e as { kind: "data_reload"; data_source_ref: string }).data_source_ref),
    );
    emitModuleEvent({ kind: "config_reload", module_id: "menus" });
    expect(seen).toEqual([]);
  });
});
