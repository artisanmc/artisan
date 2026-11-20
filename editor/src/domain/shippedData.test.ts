import type { ProjectId } from "@/domain/types";
import { projectFromFiles } from "@/schema/projectFromFiles";
import { projectToFiles } from "@/schema/projectToFiles";
import { describe, expect, it } from "vitest";
import { dropShippedData, shippedDataFiles } from "./shippedData";

const PID = "p_shipped" as ProjectId;
const base = `plugins/Artisan/projects/${PID}`;
const rewards = "cycle_length: 28\ndays:\n  7:\n    icon: { material: IRON_INGOT }\n";

const disk: Record<string, string> = {
  "artisan-module.yml": "schema: module/v1\ndefault_lang: en\nlanguages: [en]\n",
  "originals/originals.yml": "module: daily\nversion: 2\nrequired: [data/rewards.yml]\n",
  "originals/data/rewards.yml": rewards,
  "originals/data/settings.yml": "reset_time: '00:00'\n",
  "originals/models/rewards.yml": "model: daily:rewards\n",
};
const files = Object.fromEntries(Object.entries(disk).map(([k, v]) => [`${base}/${k}`, v]));

describe("the data a module ships (originals/data, originals/models)", () => {
  it("serves at the owner's path while the owner has no copy", () => {
    expect([...shippedDataFiles(Object.keys(disk)).entries()]).toEqual([
      ["data/rewards.yml", "originals/data/rewards.yml"],
      ["data/settings.yml", "originals/data/settings.yml"],
      ["models/rewards.yml", "originals/models/rewards.yml"],
    ]);
    const owned = shippedDataFiles([
      ...Object.keys(disk),
      "data/rewards.yaml",
      "data/settings/a.yml",
    ]);
    expect([...owned.keys()]).toEqual(["models/rewards.yml"]);
  });

  it("is read as a source: the Rewards and Settings screens have their data", () => {
    const project = projectFromFiles(PID, files);
    const source = project.dataSources.find((d) => String(d.id) === "rewards");
    expect(source?.shape).toBe("config");
    expect((source as unknown as { value: { cycle_length: number } }).value.cycle_length).toBe(28);
    expect(project.dataSources.some((d) => String(d.id) === "settings")).toBe(true);
  });

  it("is written only once it differs from what the module ships", () => {
    const tree = {
      "artisan-module.yml": disk["artisan-module.yml"]!,
      "data/rewards.yml": rewards.replace("IRON_INGOT }", "IRON_INGOT }  "),
      "data/settings.yml": "reset_time: '06:00'\n",
      "models/rewards.yml": "model: daily:rewards\n",
    };
    expect(Object.keys(dropShippedData(tree, disk)).sort()).toEqual([
      "artisan-module.yml",
      "data/settings.yml",
    ]);
    // The owner's own copy, even equal to the original, stays theirs.
    const owned = { ...disk, "data/rewards.yml": rewards };
    expect(Object.keys(dropShippedData(tree, owned))).toContain("data/rewards.yml");
  });

  it("an unchanged project writes none of the shipped data", () => {
    const out = projectToFiles(projectFromFiles(PID, files));
    const rel = Object.keys(out).map((k) => k.slice(base.length + 1));
    const tree = Object.fromEntries(rel.map((r, i) => [r, Object.values(out)[i]!]));
    const kept = Object.keys(dropShippedData(tree, disk));
    expect(kept.filter((p) => p.startsWith("data/") || p.startsWith("models/"))).toEqual([]);
  });
});
