import { Button } from "@artisan/editor-sdk";
import { useState } from "react";
// Host import — P1c debt: modules compile against `@/state/accountStore` (host
// internals) rather than a stable SDK surface. Acceptable for the tracer-bullet
// module; promote to an SDK-exposed hook once P1c ships a real package split.
import { useAccountStore } from "@/state/accountStore";
import { MaterialRefField } from "@/features/canvas/MaterialRefField";
import { ControlledStepsEditor } from "@/features/flow/ControlledStepsEditor";
import { stepsFromWire, stepsToWire } from "@/lib/literalSteps";
import type { ProjectId } from "@/domain/types";
import type { BoutiqueCategory, BoutiqueItem, BoutiqueState } from "./state";
import { hasBoutiqueData, readBoutiqueState } from "./state";

// The active project is the first one that actually holds boutique data
// (moduleData.boutique), not blindly projectOrder[0]; when several projects
// have boutique data a select lets the user pick. Writes go through
// setModuleData on that project and strip the parse-failure passthrough
// (rawShopYaml/parseFailed) — an explicit edit legitimately takes over —
// while extraFiles keeps flowing through.

function makeId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

function emptyItem(): BoutiqueItem {
  return { id: makeId("item"), name: "New item", icon: "BARRIER", price: 0, discount: 0, lore: [], actions: "" };
}

function emptyCategory(): BoutiqueCategory {
  return { id: makeId("cat"), name: "New category", icon: "CHEST", discount: 0, items: [] };
}

export function BoutiqueScreen() {
  const projects = useAccountStore((s) => s.account.projects);
  const projectOrder = useAccountStore((s) => s.account.projectOrder);
  const setModuleData = useAccountStore((s) => s.setModuleData);

  const dataProjects = projects.filter((p) => hasBoutiqueData(p));
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const activeProjectId =
    (selectedProjectId && dataProjects.some((p) => p.id === selectedProjectId)
      ? selectedProjectId
      : undefined) ??
    dataProjects[0]?.id ??
    projectOrder[0];
  const project = projects.find((p) => p.id === activeProjectId);

  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);

  if (!project) {
    return (
      <div className="flex flex-1 items-center justify-center text-[var(--text-mut)]">
        No project available.
      </div>
    );
  }

  const state = readBoutiqueState(project);
  const selectedCategory = state.categories.find((c) => c.id === selectedCategoryId) ?? state.categories[0] ?? null;

  function write(next: BoutiqueState) {
    // Explicit edit: keep extraFiles flowing through, drop the parse-failure
    // passthrough — the structured state legitimately takes over shop.yaml.
    const { rawShopYaml: _raw, parseFailed: _failed, ...clean } = next;
    setModuleData(project!.id, "boutique", clean);
  }

  function addCategory() {
    const cat = emptyCategory();
    write({ ...state, categories: [...state.categories, cat] });
    setSelectedCategoryId(cat.id);
  }

  function removeCategory(id: string) {
    write({ ...state, categories: state.categories.filter((c) => c.id !== id) });
    if (selectedCategoryId === id) setSelectedCategoryId(null);
  }

  function updateCategory(id: string, patch: Partial<BoutiqueCategory>) {
    write({
      ...state,
      categories: state.categories.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    });
  }

  function addItem(categoryId: string) {
    write({
      ...state,
      categories: state.categories.map((c) =>
        c.id === categoryId ? { ...c, items: [...c.items, emptyItem()] } : c,
      ),
    });
  }

  function removeItem(categoryId: string, itemId: string) {
    write({
      ...state,
      categories: state.categories.map((c) =>
        c.id === categoryId ? { ...c, items: c.items.filter((i) => i.id !== itemId) } : c,
      ),
    });
  }

  function updateItem(categoryId: string, itemId: string, patch: Partial<BoutiqueItem>) {
    write({
      ...state,
      categories: state.categories.map((c) =>
        c.id === categoryId
          ? { ...c, items: c.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)) }
          : c,
      ),
    });
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold text-[var(--text)]">Boutique</h1>
        {dataProjects.length > 1 && (
          <label className="flex items-center gap-2 text-sm text-[var(--text-mut)]">
            Project
            <select
              className="input"
              value={activeProjectId}
              onChange={(e) => {
                setSelectedProjectId(e.target.value);
                setSelectedCategoryId(null);
              }}
            >
              {dataProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name || p.id}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex items-center gap-2 text-sm text-[var(--text-mut)]">
          Whole shop discount
          <input
            className="input w-24"
            type="number"
            value={state.wholeShopDiscount}
            onChange={(e) => write({ ...state, wholeShopDiscount: Number(e.target.value) })}
          />
        </label>
      </div>

      <div className="flex flex-1 gap-6">
        <div className="flex w-64 flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--text-mut)]">Categories</h2>
            <Button variant="secondary" onClick={addCategory}>
              + Category
            </Button>
          </div>
          <ul className="flex flex-col gap-1">
            {state.categories.map((cat) => (
              <li key={cat.id} className="flex items-center gap-1">
                <button
                  type="button"
                  className={`flex-1 rounded-[var(--r-md)] px-3 py-2 text-left text-sm ${
                    selectedCategory?.id === cat.id
                      ? "bg-[var(--surface-hover)] text-[var(--text)]"
                      : "text-[var(--text-mut)] hover:bg-[var(--surface-hover)]"
                  }`}
                  onClick={() => setSelectedCategoryId(cat.id)}
                >
                  {cat.name || "(unnamed)"}
                </button>
                <Button variant="secondary" onClick={() => removeCategory(cat.id)}>
                  ×
                </Button>
              </li>
            ))}
          </ul>
          {state.categories.length === 0 && (
            <p className="text-sm text-[var(--text-faint)]">No categories yet.</p>
          )}
        </div>

        {selectedCategory && (
          <div className="flex flex-1 flex-col gap-4">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-sm text-[var(--text-mut)]">
                Name
                <input
                  className="input"
                  value={selectedCategory.name}
                  onChange={(e) => updateCategory(selectedCategory.id, { name: e.target.value })}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-[var(--text-mut)]">
                Icon
                <MaterialRefField
                  projectId={project.id as ProjectId}
                  value={selectedCategory.icon}
                  onChange={(icon) => updateCategory(selectedCategory.id, { icon })}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-[var(--text-mut)]">
                Discount
                <input
                  className="input w-24"
                  type="number"
                  value={selectedCategory.discount}
                  onChange={(e) => updateCategory(selectedCategory.id, { discount: Number(e.target.value) })}
                />
              </label>
              <Button variant="secondary" onClick={() => addItem(selectedCategory.id)}>
                + Item
              </Button>
            </div>

            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-[var(--text-mut)]">
                  <th className="p-2">Name</th>
                  <th className="p-2">Icon</th>
                  <th className="p-2">Price</th>
                  <th className="p-2">Discount</th>
                  <th className="p-2">Lore</th>
                  <th className="p-2">Purchase actions</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {selectedCategory.items.map((item) => (
                  <tr key={item.id} className="border-t border-[var(--border-soft)]">
                    <td className="p-2">
                      <input
                        className="input"
                        value={item.name}
                        onChange={(e) => updateItem(selectedCategory.id, item.id, { name: e.target.value })}
                      />
                    </td>
                    <td className="p-2">
                      <MaterialRefField
                        projectId={project.id as ProjectId}
                        value={item.icon}
                        onChange={(icon) => updateItem(selectedCategory.id, item.id, { icon })}
                      />
                    </td>
                    <td className="p-2">
                      <input
                        className="input w-24"
                        type="number"
                        value={item.price}
                        onChange={(e) =>
                          updateItem(selectedCategory.id, item.id, { price: Number(e.target.value) })
                        }
                      />
                    </td>
                    <td className="p-2">
                      <input
                        className="input w-24"
                        type="number"
                        value={item.discount}
                        onChange={(e) =>
                          updateItem(selectedCategory.id, item.id, { discount: Number(e.target.value) })
                        }
                      />
                    </td>
                    <td className="p-2">
                      <textarea
                        className="textarea"
                        value={item.lore.join("\n")}
                        onChange={(e) =>
                          updateItem(selectedCategory.id, item.id, {
                            lore: e.target.value.split("\n").filter((l) => l.length > 0),
                          })
                        }
                      />
                    </td>
                    <td className="min-w-72 p-2">
                      <ControlledStepsEditor
                        projectId={project.id as ProjectId}
                        value={stepsFromWire(item.actions)}
                        onChange={(steps) =>
                          updateItem(selectedCategory.id, item.id, { actions: stepsToWire(steps) })
                        }
                      />
                    </td>
                    <td className="p-2">
                      <Button variant="secondary" onClick={() => removeItem(selectedCategory.id, item.id)}>
                        ×
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {selectedCategory.items.length === 0 && (
              <p className="text-sm text-[var(--text-faint)]">No items in this category yet.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
