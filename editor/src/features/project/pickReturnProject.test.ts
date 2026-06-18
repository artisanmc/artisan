import { describe, expect, it } from "vitest";
import { pickReturnProject } from "./pickReturnProject";

const projects = [{ id: "pack_a" }, { id: "pack_b" }, { id: "pack_c" }];

describe("pickReturnProject", () => {
  it("returns the last-active pack when it is among the session projects", () => {
    // The bug: a reload landed on projects[0] instead of where you were.
    expect(pickReturnProject(projects, "pack_c")).toEqual({ id: "pack_c" });
    expect(pickReturnProject(projects, "pack_b")).toEqual({ id: "pack_b" });
  });

  it("falls back to the first pack when lastActiveProjectId is not in the list", () => {
    expect(pickReturnProject(projects, "pack_from_another_server")).toEqual({ id: "pack_a" });
  });

  it("falls back to the first pack when no lastActiveProjectId is recorded", () => {
    expect(pickReturnProject(projects, null)).toEqual({ id: "pack_a" });
  });

  it("returns undefined when there are no projects", () => {
    expect(pickReturnProject([], "pack_a")).toBeUndefined();
    expect(pickReturnProject([], null)).toBeUndefined();
  });
});
