import { beforeEach, expect, it } from "vitest";
import { applyOrder, sidebarOrderOf, useSidebarOrderStore } from "./sidebarOrderStore";

beforeEach(() => {
  localStorage.clear();
  useSidebarOrderStore.setState({ orders: {} });
});

const id = (s: string) => s;

it("puts the stored ids first, then the others in their incoming order", () => {
  expect(applyOrder(["a", "b", "c", "d"], ["c", "a"], id)).toEqual(["c", "a", "b", "d"]);
});

it("skips a stored id whose folder is gone", () => {
  expect(applyOrder(["a", "b"], ["gone", "b", "a"], id)).toEqual(["b", "a"]);
});

it("keeps one order per server and per section", () => {
  const { setOrder } = useSidebarOrderStore.getState();
  setOrder("sk_1", "mine", ["b", "a"]);
  setOrder("sk_1", "installed", ["quests"]);
  setOrder("sk_2", "mine", ["x"]);
  const { orders } = useSidebarOrderStore.getState();
  expect(sidebarOrderOf(orders, "sk_1", "mine")).toEqual(["b", "a"]);
  expect(sidebarOrderOf(orders, "sk_1", "installed")).toEqual(["quests"]);
  expect(sidebarOrderOf(orders, "sk_2", "mine")).toEqual(["x"]);
  expect(sidebarOrderOf(orders, "sk_3", "mine")).toEqual([]);
});

it("restores the order after a reload, and ignores a broken stored value", async () => {
  const name = useSidebarOrderStore.persist.getOptions().name!;
  useSidebarOrderStore.getState().setOrder("sk_1", "mine", ["b", "a"]);
  const saved = localStorage.getItem(name)!;
  useSidebarOrderStore.setState({ orders: {} });
  localStorage.setItem(name, saved);
  await useSidebarOrderStore.persist.rehydrate();
  expect(sidebarOrderOf(useSidebarOrderStore.getState().orders, "sk_1", "mine")).toEqual([
    "b",
    "a",
  ]);

  localStorage.setItem(name, JSON.stringify({ state: { orders: ["nope"] }, version: 0 }));
  await useSidebarOrderStore.persist.rehydrate();
  expect(useSidebarOrderStore.getState().orders).toEqual({});
});
