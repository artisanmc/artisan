import type { CapturedItem, ProjectId } from "@/domain/types";
import { mockOpenProjects } from "@/mock/fixtures";
import { useProjectsStore } from "@/state/projectsStore";
import { beforeEach, expect, test } from "vitest";
import { adoptCapturedItem } from "./adoptCapturedItem";

const shop = "p_shop_system" as ProjectId;
const item = (id: string, stackYaml: string): CapturedItem =>
  ({ id, name: "Épée", stackYaml, display: { material: "DIAMOND_SWORD" } }) as CapturedItem;
const items = () =>
  useProjectsStore.getState().openProjects.projects.find((p) => p.id === shop)?.capturedItems ?? [];

beforeEach(() => useProjectsStore.setState({ openProjects: mockOpenProjects() }));

test("copies another project's item once, under its own id", () => {
  const sword = item("ci_1", "type: DIAMOND_SWORD\n");
  expect(adoptCapturedItem(shop, sword)).toBe("item:ci_1");
  expect(adoptCapturedItem(shop, sword)).toBe("item:ci_1");
  expect(items()).toEqual([sword]);
  expect(items()[0]).not.toBe(sword);
});

test("an item already here keeps its version: the copy is a snapshot", () => {
  adoptCapturedItem(shop, item("ci_1", "type: DIAMOND_SWORD\n"));
  // The original changed in its project afterwards.
  expect(adoptCapturedItem(shop, item("ci_1", "type: NETHERITE_SWORD\n"))).toBe("item:ci_1");
  expect(items()[0]?.stackYaml).toBe("type: DIAMOND_SWORD\n");
});

test("the same stack under another id is reused", () => {
  adoptCapturedItem(shop, item("ci_1", "type: DIAMOND_SWORD\n"));
  expect(adoptCapturedItem(shop, item("ci_9", "type: DIAMOND_SWORD\n"))).toBe("item:ci_1");
  expect(items()).toHaveLength(1);
});
