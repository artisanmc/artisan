import { projectId } from "@/domain/ids";
import { expect, test } from "vitest";
import { parse } from "yaml";
import fixture from "../../../backend/src/templates/demo-project.json";
import { projectFromFiles } from "./projectFromFiles";
import { validateMenuV1 } from "./validateMenuV1";
test("the shared demo has a valid three-row menu with visible vanilla items and board placement", () => {
  const menu = parse(fixture["menus/welcome.yaml"]);
  expect(validateMenuV1(menu)).toEqual({ valid: true, errors: [] });
  const files = Object.fromEntries(
    Object.entries(fixture).map(([path, contents]) => [
      `plugins/Artisan/projects/demo/${path}`,
      contents,
    ]),
  );
  const project = projectFromFiles(projectId("demo"), files, {
    name: "Your first menu",
    diskId: "demo",
  });
  expect(project.menus[0]?.rows).toBe(3);
  expect(project.menus[0]?.layers[0]?.elements.map((element) => element.display.material)).toEqual([
    "COMPASS",
    "DIAMOND",
    "BOOK",
  ]);
  expect(project.canvasLayout.welcome).toMatchObject({ x: 0, y: 0 });
});
