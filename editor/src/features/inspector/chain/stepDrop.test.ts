import { describe, expect, it } from "vitest";
import { dropTarget } from "./stepDrop";

const rect = (top: number, height = 20) => ({
  top,
  height,
  bottom: top + height,
  left: 0,
  right: 100,
  width: 100,
});
const branch = [{ stepIndex: 0, descend: { case: 0 } as const }];

describe("dropTarget", () => {
  it("appends when dropped on a list", () => {
    expect(
      dropTarget(
        { frames: [], index: 1 },
        { frames: branch, index: 2, list: true },
        rect(0),
        rect(0, 200),
      ),
    ).toEqual({ frames: branch, index: 2 });
  });

  it("takes the step's index in the same list (array move)", () => {
    expect(
      dropTarget({ frames: [], index: 0 }, { frames: [], index: 2 }, rect(100), rect(0)),
    ).toEqual({
      frames: [],
      index: 2,
    });
  });

  it("goes before or after a step of another list by the dragged step's centre", () => {
    const over = { frames: branch, index: 1 };
    expect(dropTarget({ frames: [], index: 3 }, over, rect(40), rect(50))).toEqual({
      frames: branch,
      index: 1,
    });
    expect(dropTarget({ frames: [], index: 3 }, over, rect(60), rect(50))).toEqual({
      frames: branch,
      index: 2,
    });
  });
});
