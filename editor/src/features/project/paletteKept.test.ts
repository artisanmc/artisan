import { adoptDiskIntoProject, projectTree } from "@/features/project/saveProjectToDisk";
import { projectFromFiles } from "@/schema/projectFromFiles";
import { expect, test } from "vitest";
test("a Project open in the tab keeps its palette.yml, a file none of its views edits", () => {
  const base = "plugins/Artisan/projects/noel/";
  const p = projectFromFiles("noel" as never, { [`${base}palette.yml`]: "primary: '#111111'\n" }, {
    name: "noel",
  } as never);
  expect(projectTree(p)["palette.yml"]).toBe("primary: '#111111'\n");
  const q = adoptDiskIntoProject(p, { "palette.yml": "primary: '#222222'\n" }, []);
  expect(projectTree(q)["palette.yml"]).toBe("primary: '#222222'\n");
  const r = adoptDiskIntoProject(q, {}, ["palette.yml"]);
  expect(projectTree(r)["palette.yml"]).toBeUndefined();
});
