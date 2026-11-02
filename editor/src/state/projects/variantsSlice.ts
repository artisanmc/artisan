import { revertToOriginal } from "@/domain/originals";
import type { ProjectId, VariantRule } from "@/domain/types";
import {
  addVariant,
  createVersion,
  dropVersion,
  removeVariant,
  setVariantRules,
  showOriginal,
  showVariant,
} from "@/domain/variants";
import type { ProjectsSliceContext } from "./types";

/** A module's variants (`domain/variants.ts`): what the canvas shows, versions, rules. */
export interface VariantsSlice {
  /** "View as": the variant's versions on the canvas; undefined shows the module's own. */
  showVariant: (projectId: ProjectId, variant: string | undefined) => void;
  /** "View as" the module's original, in the variant viewed: what it ships, read-only. */
  showOriginal: (projectId: ProjectId, on: boolean) => void;
  /** A new variant, its rule off; false when the name is taken or not a folder name. */
  addVariant: (projectId: ProjectId, name: string) => boolean;
  removeVariant: (projectId: ProjectId, name: string) => void;
  /** The viewed variant gets its own copy of the Document. */
  createVersion: (projectId: ProjectId, kind: string, id: string) => void;
  /** The viewed variant drops its version: the module's Document shows again. */
  dropVersion: (projectId: ProjectId, kind: string, id: string) => void;
  setVariantRules: (projectId: ProjectId, rules: VariantRule[]) => void;
  /** The Document shown becomes what the module ships again (`domain/originals.ts`). */
  revertToOriginal: (projectId: ProjectId, kind: string, id: string) => void;
}

export const createVariantsSlice = ({ mutateProject }: ProjectsSliceContext): VariantsSlice => ({
  showVariant: (projectId, variant) =>
    mutateProject(
      projectId,
      (p) => {
        // In the original, the variant's shipped versions take the place of the others.
        const original = p.originalView !== undefined;
        showOriginal(p, false);
        showVariant(p, variant);
        if (original) showOriginal(p, true);
        return false;
      },
      { view: true },
    ),
  showOriginal: (projectId, on) =>
    mutateProject(
      projectId,
      (p) => {
        showOriginal(p, on);
        return false;
      },
      { view: true },
    ),
  addVariant: (projectId, name) => {
    let added = false;
    mutateProject(projectId, (p) => {
      added = addVariant(p, name);
      if (!added) return false;
    });
    return added;
  },
  removeVariant: (projectId, name) => mutateProject(projectId, (p) => removeVariant(p, name)),
  createVersion: (projectId, kind, id) =>
    mutateProject(projectId, (p) => {
      if (!createVersion(p, kind, id)) return false;
    }),
  dropVersion: (projectId, kind, id) =>
    mutateProject(projectId, (p) => {
      if (!dropVersion(p, kind, id)) return false;
    }),
  setVariantRules: (projectId, rules) => mutateProject(projectId, (p) => setVariantRules(p, rules)),
  revertToOriginal: (projectId, kind, id) =>
    mutateProject(projectId, (p) => {
      if (!revertToOriginal(p, kind, id)) return false;
    }),
});
