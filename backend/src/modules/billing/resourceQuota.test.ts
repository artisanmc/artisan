import { describe, expect, test } from "bun:test";
import { assessResourceMutation, countPersonalResources, hasProAccess, resourceKind } from "./resourceQuota";

const personal = (count: number) => Array.from({ length: count }, (_, i) => ({
  projectId: "personal",
  path: `menus/menu_${i}.yaml`,
  origin: "personal" as const,
}));

describe("resource quota", () => {
  test("counts only root editable resources, including invalid YAML files", () => {
    expect(resourceKind("menus/nested/broken.yaml")).toBe("menu");
    expect(resourceKind("commands/root.yml")).toBe("command");
    expect(resourceKind("menus/a/buttons/x.yaml")).toBe(null);
    expect(resourceKind("lang/en.yaml")).toBe(null);
    expect(countPersonalResources([
      { projectId: "p", path: "menus/a.yaml", origin: "personal" },
      { projectId: "p", path: "dialogs/b.yaml", origin: "module" },
      { projectId: "p", path: "assets/icon.png", origin: "personal" },
    ])).toBe(1);
  });

  test("allows creation up to Q and modification at Q", () => {
    const nine = personal(9);
    expect(assessResourceMutation({ quota: 10, pro: false, inventory: nine, projectId: "personal", origin: "personal", files: ["menus/new.yaml"] })).toEqual({ allowed: true, count: 10, reason: null });
    const ten = personal(10);
    expect(assessResourceMutation({ quota: 10, pro: false, inventory: ten, projectId: "personal", origin: "personal", files: ["menus/menu_0.yaml"] }).allowed).toBe(true);
    expect(assessResourceMutation({ quota: 10, pro: false, inventory: ten, projectId: "personal", origin: "personal", files: ["menus/new.yaml"] }).reason).toBe("free_quota_reached");
  });

  test("locks all personal changes over Q, but permits explicit deletion and module changes", () => {
    const eleven = personal(11);
    expect(assessResourceMutation({ quota: 10, pro: false, inventory: eleven, projectId: "personal", origin: "personal", files: ["menus/menu_0.yaml"] }).reason).toBe("free_quota_exceeded");
    expect(assessResourceMutation({ quota: 10, pro: false, inventory: eleven, projectId: "personal", origin: "personal", deletes: ["menus/menu_0.yaml"] })).toEqual({ allowed: true, count: 10, reason: null });
    expect(assessResourceMutation({ quota: 10, pro: false, inventory: eleven, projectId: "personal", origin: "personal", deletes: ["lang/en.yaml"] }).reason).toBe("free_quota_exceeded");
    expect(assessResourceMutation({ quota: 10, pro: false, inventory: eleven, projectId: "addon", origin: "module", files: ["menus/custom.yaml"] }).allowed).toBe(true);
  });

  test("validates a whole batch before writing", () => {
    expect(assessResourceMutation({ quota: 10, pro: false, inventory: personal(9), projectId: "personal", origin: "personal", files: ["menus/new.yaml", "dialogs/extra.yaml"] }).reason).toBe("free_quota_reached");
    expect(assessResourceMutation({ quota: 10, pro: false, inventory: personal(11), projectId: "personal", origin: "personal", files: ["menus/new.yaml"], deletes: ["menus/menu_0.yaml", "menus/menu_1.yaml"] }).reason).toBe("free_quota_exceeded");
  });

  test("Pro can use 250 resources per server", () => {
    expect(assessResourceMutation({ quota: 10, pro: true, inventory: personal(249), projectId: "personal", origin: "personal", files: ["menus/new.yaml"] })).toEqual({ allowed: true, count: 250, reason: null });
    expect(assessResourceMutation({ quota: 10, pro: true, inventory: personal(250), projectId: "personal", origin: "personal", files: ["menus/new.yaml"] }).allowed).toBe(false);
  });

  test("paid period, not renewal status, determines Pro access", () => {
    const now = new Date("2026-09-25T12:00:00Z");
    expect(hasProAccess({ paidEditorPro: true, currentPeriodId: "invoice_1", paidThrough: new Date("2026-10-01T00:00:00Z"), status: "canceled" }, now)).toBe(true);
    expect(hasProAccess({ paidEditorPro: true, currentPeriodId: "invoice_1", paidThrough: new Date("2026-09-24T00:00:00Z"), status: "active" }, now)).toBe(false);
    expect(hasProAccess({ paidEditorPro: true, currentPeriodId: null, paidThrough: null, status: "active" }, now)).toBe(false);
    expect(hasProAccess({ paidEditorPro: false, currentPeriodId: "invoice_1", paidThrough: new Date("2026-10-01T00:00:00Z"), status: "active" }, now)).toBe(false);
    const unconfirmedRenewal = { paidEditorPro: true, currentPeriodId: "invoice_1", paidThrough: new Date("2026-09-24T00:00:00Z"), currentPeriodEnd: new Date("2026-10-01T00:00:00Z"), status: "active" };
    expect(hasProAccess(unconfirmedRenewal, now)).toBe(false);
  });
});
