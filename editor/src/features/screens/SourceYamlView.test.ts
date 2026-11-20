import type { ProjectId } from "@/domain/types";
import { projectTree } from "@/features/project/saveProjectToDisk";
import { flattenLangTree } from "@/lib/langTree";
import { projectFromFiles } from "@/schema/projectFromFiles";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectsStore } from "@/state/projectsStore";
import { beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { dataSourceRelPath, sourceFileText, sourceFromText } from "./SourceYamlView";

const PID = "p_daily" as ProjectId;
const base = `plugins/Artisan/projects/${PID}`;
// Daily rewards' layout: the module ships its data; the owner has no copy yet.
const disk: Record<string, string> = {
  "artisan-module.yml": "schema: module/v1\ndefault_lang: en\nlanguages: [en, fr]\n",
  "originals/originals.yml": "module: daily\nversion: 1\nrequired: [data/settings.yml]\n",
  "originals/data/settings.yml": "# Shipped by the module\nmotd: Welcome\n",
  "originals/models/settings.yml":
    "schema: model/v1\nid: settings\nname: settings\nfields:\n  - name: motd\n    type: { kind: ltext }\n",
  "lang/fr.yml": "sources:\n  settings:\n    motd: Bienvenue\n",
};

function load() {
  return projectFromFiles(
    PID,
    Object.fromEntries(Object.entries(disk).map(([k, v]) => [`${base}/${k}`, v])),
  );
}

describe("a Config screen's file in YAML", () => {
  beforeEach(() => {
    useProjectBaselineStore.setState({ baselines: { [PID]: { ...disk } } });
    useProjectsStore.setState({
      openProjects: { projects: [load()], projectOrder: [PID] },
    } as never);
  });

  const project = () => useProjectsStore.getState().openProjects.projects[0]!;
  const settings = () => project().dataSources.find((d) => String(d.id) === "settings")!;

  it("starts from the file the module ships while the owner has no copy, comments included", () => {
    const relPath = dataSourceRelPath(project(), settings());
    expect(relPath).toBe("data/settings.yml");
    expect(sourceFileText(project(), relPath!, disk)).toBe(disk["originals/data/settings.yml"]);
  });

  it("applies to the working copy and keeps the other languages' texts (lang/<lang>.yml)", () => {
    const parsed = sourceFromText(project(), settings(), "data/settings.yml", "motd: Hello\n");
    expect(parsed).not.toBeNull();
    useProjectsStore.getState().replaceSourceFromFile({ projectId: PID, ...parsed! });
    const tree = projectTree(project());
    expect(parse(tree["data/settings.yml"]!)).toEqual({ motd: "Hello" });
    expect(flattenLangTree(parse(tree["lang/fr.yml"]!))["sources.settings.motd"]).toBe("Bienvenue");
    // The view now starts from what the next Deploy writes.
    expect(parse(sourceFileText(project(), "data/settings.yml", disk))).toEqual({ motd: "Hello" });
  });

  it("refuses a text that is not YAML", () => {
    expect(sourceFromText(project(), settings(), "data/settings.yml", "motd: [\n")).toBeNull();
  });
});
