import { describe, expect, it } from "vitest";
import { commandsModule } from "./index";

describe("commandsModule (editor)", () => {
  it("has id 'commands' and points to the home page", () => {
    expect(commandsModule.id).toBe("commands");
    expect(commandsModule.sidebar.to).toBe("/");
  });
});
