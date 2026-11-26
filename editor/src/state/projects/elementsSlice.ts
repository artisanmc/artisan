import type { componentLook } from "@/domain/components";
import { docKey, mutableCommands, mutableMenus } from "@/domain/documents";
import { addressedAppearances, appearanceAt } from "@/domain/element";
import { clampRefreshTicks } from "@/domain/elementRefresh";
import { rekeyCommand, rekeyMenu } from "@/domain/i18nSites";
import { newLayerId } from "@/domain/ids";
import {
  assertImageButtonPlacement,
  hasImageButton,
  imageButtonRect,
  imageButtonSize,
  rectanglePositions,
} from "@/domain/imageButton";
import type { AdvancedFields } from "@/domain/itemAdvanced";
import { type StepFrame, type StepPath, moveStepMut, resolveParentMut } from "@/domain/stepPath";
import type {
  Appearance,
  ClickType,
  Command,
  Condition,
  Element,
  ElementId,
  I18nKey,
  Layer,
  Menu,
  MenuId,
  Placement,
  Project,
  ProjectId,
  Step,
} from "@/domain/types";
import { cellToPosition, positionCount, positionToCell } from "@/features/canvas/inventoryTypes";
import { createLText, createLTextAt, deleteLText, setLText } from "@/lib/i18n";
import {
  addPosition,
  formatPositions,
  parsePositions,
  positionsContains,
  removePosition,
} from "@/lib/positions";
import { current } from "immer";
import { stringify } from "yaml";
import type { PartAnchor } from "../../../../docs/schema/menu/v1/imageButtonGeometry";
import {
  allocStepLTexts,
  appearanceClickPrefixFor,
  appearanceLabelKeyFor,
  appearanceLoreKeyFor,
  appearanceTitleKeyFor,
  cloneAppearanceLTextsInto,
  duplicateStepLTexts,
  gcAppearanceLTexts,
  gcElementLTexts,
  gcStepLTexts,
  lendTexts,
  nextElementIdForMaterial,
  returnTexts,
} from "./helpers";
import { type Mutation, findElement } from "./mutate";

type LookParts = NonNullable<Appearance["parts"]>;

/** One edit of a look's pieces (`editAppearanceParts`). */
export type PartsEdit =
  | { type: "start" }
  | { type: "addImage"; asset: string; positions?: string }
  | { type: "addLabel"; lang: string }
  | {
      type: "patch";
      index: number;
      patch: {
        image?: string;
        fit?: "contain" | "stretch" | "native";
        anchor?: PartAnchor;
        size?: 8 | 12 | 16 | 20 | 24 | 32;
        offset_x?: number;
        offset_y?: number;
      };
    }
  | { type: "text"; index: number; lang: string; value: string }
  | { type: "move"; index: number; to: number }
  | { type: "remove"; index: number };

/** The image and the label of a look as the two pieces they mean, the label's text kept. */
function partsOfLook(appearance: Appearance): LookParts {
  const out: LookParts = [];
  const { image, label } = appearance;
  if (image)
    out.push({
      image: image.asset,
      // A piece is drawn at its own size unless it says otherwise.
      ...((image.fit ?? "contain") !== "native" ? { fit: image.fit ?? "contain" } : {}),
      ...(image.anchor ? { anchor: image.anchor } : {}),
      ...(image.offset_x ? { offset_x: image.offset_x } : {}),
      ...(image.offset_y ? { offset_y: image.offset_y } : {}),
    });
  if (label)
    out.push({
      label: label.text,
      ...(label.align && label.align !== "center" ? { anchor: label.align } : {}),
      ...(label.size ? { size: label.size } : {}),
      ...(label.offset_x ? { offset_x: label.offset_x } : {}),
      ...(label.offset_y ? { offset_y: label.offset_y } : {}),
    });
  return out;
}

/** A look that shows an item keeps its text pieces and loses its image pieces. */
function dropImageParts(appearance: Appearance) {
  if (!appearance.parts) return;
  const texts = appearance.parts.filter((part) => !("image" in part));
  if (texts.length) appearance.parts = texts;
  else Reflect.deleteProperty(appearance, "parts");
}
import type { AppearanceTarget, ProjectsSliceContext } from "./types";

/** A menu's content: elements, slots, appearances, positions, steps and click handlers. */
export interface ElementsSlice {
  /** Element iteration: bind this element's slots to a list source in the menu context. */
  setElementIterates: (input: {
    projectId: ProjectId;
    menuId: MenuId;
    elementId: ElementId;
    iterates: { source: string; alias: string } | undefined;
  }) => void;
  /**
   * Placement mode: set (or clear with `undefined`) this element's `places` binding.
   * Mutually exclusive with iteration — setting it clears `iterates`.
   */
  setElementPlaces: (input: {
    projectId: ProjectId;
    menuId: MenuId;
    elementId: ElementId;
    places: Element["places"] | undefined;
  }) => void;
  /** Upsert a single Placement (matched by `key`) into an element's `places`. No-op if not in placement mode. */
  setElementPlacement: (input: {
    projectId: ProjectId;
    menuId: MenuId;
    elementId: ElementId;
    placement: Placement;
  }) => void;
  /** Remove the Placement with the given `key` from an element's `places`. */
  removeElementPlacement: (input: {
    projectId: ProjectId;
    menuId: MenuId;
    elementId: ElementId;
    key: string;
  }) => void;
  /** Rename an element's id. Rejects if newId already exists in the same menu. */
  setElementId: (input: {
    projectId: ProjectId;
    menuId: MenuId;
    oldId: ElementId;
    newId: ElementId;
  }) => void;
  setSlotMaterial: (input: {
    projectId: ProjectId;
    menuId: MenuId;
    position: number;
    material: string;
  }) => void;
  /** Removes the element at the given position from the menu's first layer. */
  clearSlot: (input: { projectId: ProjectId; menuId: MenuId; position: number }) => void;
  /** Update a scalar field on the element's appearance at the given index (default 0). */
  setAppearanceField: (
    input: {
      projectId: ProjectId;
      appearanceIndex?: number;
      field: "count" | "material" | "head" | "item" | "loreMode" | "title" | "lore";
      value: string | number | undefined;
    } & AppearanceTarget,
  ) => void;
  setAppearanceImage: (
    input: AppearanceTarget & {
      projectId: ProjectId;
      appearanceIndex?: number;
      image: import("@/domain/types").Appearance["image"];
      positions?: string;
    },
  ) => void;
  /**
   * Patch the advanced detail fields of an appearance (enchants, glint, custom
   * model data, unbreakable, hide flags, tint, raw NBT). A key set to
   * `undefined` clears that field; keys absent from the patch are left alone.
   */
  setAppearanceAdvanced: (
    input: {
      projectId: ProjectId;
      appearanceIndex?: number;
      patch: AdvancedFields;
    } & AppearanceTarget,
  ) => void;
  /** Update an appearance title for the given language. Allocates the LText on first write. */
  setAppearanceTitle: (
    input: {
      projectId: ProjectId;
      appearanceIndex?: number;
      lang: string;
      value: string;
    } & AppearanceTarget,
  ) => void;
  /** Set an appearance's label text for a language; allocates the label on first write. */
  setAppearanceLabelText: (
    input: {
      projectId: ProjectId;
      appearanceIndex?: number;
      lang: string;
      value: string;
    } & AppearanceTarget,
  ) => void;
  /** Patch the label's placement (align, size, offsets), or remove the label with `null`. */
  setAppearanceLabel: (
    input: {
      projectId: ProjectId;
      appearanceIndex?: number;
      patch: Partial<
        Omit<NonNullable<import("@/domain/types").Appearance["label"]>, "text">
      > | null;
    } & AppearanceTarget,
  ) => void;
  /**
   * Edit the pieces of a look (`parts`): `start` turns its image and label into pieces,
   * the others add, change, move or remove one. Removing the last piece leaves a look
   * without pieces. A first image makes the element an image button: its slots must form
   * a free rectangle (`positions` gives the element its new slots with it).
   */
  editAppearanceParts: (
    input: {
      projectId: ProjectId;
      appearanceIndex?: number;
      op: PartsEdit;
    } & AppearanceTarget,
  ) => void;
  /**
   * The look names a component (its name, or its name and its parameters), which replaces
   * its image, label, pieces and item; `null` leaves the look without one. Fixed elements only.
   */
  setAppearanceComponent: (
    input: {
      projectId: ProjectId;
      appearanceIndex?: number;
      component: NonNullable<Appearance["component"]> | null;
    } & AppearanceTarget,
  ) => void;
  /**
   * The look stops naming its component and keeps what it draws as its own pieces
   * (`look`: what `componentLook` reads; its texts become the look's, in `lang` when single).
   */
  detachAppearanceComponent: (
    input: {
      projectId: ProjectId;
      appearanceIndex?: number;
      look: NonNullable<ReturnType<typeof componentLook>>;
      lang: string;
    } & AppearanceTarget,
  ) => void;
  /**
   * Writes the Project's component `name` (`components/<name>.yml`, its YAML as `content`),
   * or removes it with `null`. A new one takes a name that is a file's and is not taken.
   */
  writeComponent: (input: {
    projectId: ProjectId;
    name: string;
    content: string | null;
    /** The component is new: refused when one of that name exists. */
    create?: boolean;
  }) => void;
  /**
   * The look's pieces move to the file `components/<name>.yml` of the Project and the look
   * names it. Refused when the name is taken or is not a file's name, or the look draws nothing.
   */
  saveLookAsComponent: (
    input: {
      projectId: ProjectId;
      appearanceIndex?: number;
      name: string;
    } & AppearanceTarget,
  ) => void;
  /** Set the lore value (multi-line string, `\n`-separated lines) for an appearance. */
  setAppearanceLore: (
    input: {
      projectId: ProjectId;
      appearanceIndex?: number;
      lang: string;
      value: string;
    } & AppearanceTarget,
  ) => void;
  /** `refresh_ticks` of the element; undefined: drawn once, at opening. Below 2 reads 2. */
  setElementRefresh: (input: {
    projectId: ProjectId;
    menuId: MenuId;
    elementId: ElementId;
    ticks: number | undefined;
  }) => void;
  /** Replace the element's positions string (e.g. "0-8,17,26"). */
  setElementPositions: (input: {
    projectId: ProjectId;
    menuId: MenuId;
    elementId: ElementId;
    positions: string;
  }) => void;
  /**
   * Move one position of an element to another slot — atomically replaces
   * `fromPosition` with `toPosition` in the element's positions list, and
   * removes `toPosition` from any other element that might have owned it
   * (positions are unique across elements within a menu).
   */
  moveElementPosition: (input: {
    projectId: ProjectId;
    menuId: MenuId;
    elementId: ElementId;
    fromPosition: number;
    toPosition: number;
  }) => void;
  /**
   * Add a position to an element's list (Alt+drag duplicate). If another
   * element already owns the position, it loses it.
   */
  addElementPosition: (input: {
    projectId: ProjectId;
    menuId: MenuId;
    elementId: ElementId;
    position: number;
  }) => void;
  /** Remove an element from its menu, regardless of how many positions it has. */
  deleteElement: (input: { projectId: ProjectId; menuId: MenuId; elementId: ElementId }) => void;
  /** Replace one step inside a click handler's step tree at the given path. */
  setElementStep: (
    input: {
      projectId: ProjectId;
      appearanceIndex: number;
      clickType: ClickType;
      path: StepPath;
      step: Step;
      lang: string;
    } & AppearanceTarget,
  ) => void;
  /**
   * Insert a step into a click handler's step tree. `frames` describes how
   * to descend through if-steps; `index` is the position in the resolved
   * Step[] (negative or out-of-range → append).
   */
  addElementStep: (
    input: {
      projectId: ProjectId;
      appearanceIndex: number;
      clickType: ClickType;
      frames: StepFrame[];
      index: number;
      step: Step;
      lang: string;
    } & AppearanceTarget,
  ) => void;
  removeElementStep: (
    input: {
      projectId: ProjectId;
      appearanceIndex: number;
      clickType: ClickType;
      path: StepPath;
    } & AppearanceTarget,
  ) => void;
  /** Move a step within its Step[] or to another one of the chain (into / out of an `if`). */
  moveElementStep: (
    input: {
      projectId: ProjectId;
      appearanceIndex: number;
      clickType: ClickType;
      from: StepPath;
      to: StepPath;
    } & AppearanceTarget,
  ) => void;
  /** Add a new case to an if-step. */
  addIfCase: (
    input: {
      projectId: ProjectId;
      appearanceIndex: number;
      clickType: ClickType;
      frames: StepFrame[];
      ifStepIndex: number;
    } & AppearanceTarget,
  ) => void;
  /** Remove a case from an if-step. */
  removeIfCase: (
    input: {
      projectId: ProjectId;
      appearanceIndex: number;
      clickType: ClickType;
      frames: StepFrame[];
      ifStepIndex: number;
      caseIndex: number;
    } & AppearanceTarget,
  ) => void;
  /** Replace the conditions for one case of an if-step. */
  setIfCaseConditions: (
    input: {
      projectId: ProjectId;
      appearanceIndex: number;
      clickType: ClickType;
      frames: StepFrame[];
      ifStepIndex: number;
      caseIndex: number;
      conditions: Condition[];
    } & AppearanceTarget,
  ) => void;
  /** Set the operator for one joiner inside a case (between conditions[i] and [i+1]). */
  setIfCaseJoin: (
    input: {
      projectId: ProjectId;
      appearanceIndex: number;
      clickType: ClickType;
      frames: StepFrame[];
      ifStepIndex: number;
      caseIndex: number;
      joinIndex: number;
      op: "and" | "or";
    } & AppearanceTarget,
  ) => void;
  /** Toggle the else-branch of an if-step on or off. */
  toggleIfElse: (
    input: {
      projectId: ProjectId;
      appearanceIndex: number;
      clickType: ClickType;
      frames: StepFrame[];
      ifStepIndex: number;
      enabled: boolean;
    } & AppearanceTarget,
  ) => void;
  /**
   * Add an empty click handler at clickType on the given appearance. No-op
   * if a handler already exists there.
   */
  addElementClickHandler: (
    input: {
      projectId: ProjectId;
      appearanceIndex: number;
      clickType: ClickType;
    } & AppearanceTarget,
  ) => void;
  /** Remove the click handler at clickType (with its actions and fallback). */
  removeElementClickHandler: (
    input: {
      projectId: ProjectId;
      appearanceIndex: number;
      clickType: ClickType;
    } & AppearanceTarget,
  ) => void;
  /**
   * Append an EMPTY state to an element. A state is a whole appearance, not a
   * patch on the display — starting empty is what makes that visible (the slot
   * renders a bare stone block until it is filled in). Use
   * {@link duplicateAppearance} to start from an existing one instead. Seeded
   * with a placeholder condition so it doesn't match, and so doesn't shadow the
   * display. Cf. ADR `element-display-and-states`.
   */
  addAppearance: (input: { projectId: ProjectId } & AppearanceTarget) => void;
  /**
   * Append a state that copies the appearance at `appearanceIndex` (its LTexts
   * cloned, so the two never share translation keys).
   */
  duplicateAppearance: (
    input: {
      projectId: ProjectId;
      appearanceIndex: number;
    } & AppearanceTarget,
  ) => void;
  /** Remove the state at the given index. Index 0 is the display and never goes. */
  removeAppearance: (
    input: {
      projectId: ProjectId;
      appearanceIndex: number;
    } & AppearanceTarget,
  ) => void;
  /** Reorder an element's states (priority = position in the list). */
  moveAppearance: (
    input: {
      projectId: ProjectId;
      fromIndex: number;
      toIndex: number;
    } & AppearanceTarget,
  ) => void;
  /**
   * Replace the entire visibility condition list (`if`) for an appearance.
   * Empty list → unconditional (default state).
   */
  setAppearanceConditions: (
    input: {
      projectId: ProjectId;
      appearanceIndex: number;
      conditions: Condition[];
    } & AppearanceTarget,
  ) => void;
  /** Set the operator for one joiner between if-conditions on an appearance. */
  setAppearanceJoin: (
    input: {
      projectId: ProjectId;
      appearanceIndex: number;
      joinIndex: number;
      op: "and" | "or";
    } & AppearanceTarget,
  ) => void;
  /**
   * Insert a fully-formed element (already given a fresh id) into a menu's
   * first layer. Any positions claimed by the new element are stripped from
   * sibling elements (positions are unique within a menu).
   */
  /** `texts`: the clipboard's translations, for an element copied from another Project. */
  addElement: (input: {
    projectId: ProjectId;
    menuId: MenuId;
    element: Element;
    texts?: Record<I18nKey, Record<string, string>>;
  }) => void;
  addImageButton: (input: {
    projectId: ProjectId;
    menuId: MenuId;
    position: number;
    asset: { id: string; width: number; height: number };
  }) => ElementId | undefined;
  /**
   * Shift every position of every element in `elementIds` by (dCol, dRow)
   * within the menu's grid. Throws if any new position would fall outside
   * the menu. Positions claimed by the move are stripped from non-target
   * elements (takeover semantics, matching addElementPosition).
   */
  moveSelectionByDelta: (input: {
    projectId: ProjectId;
    menuId: MenuId;
    elementIds: ElementId[];
    dCol: number;
    dRow: number;
  }) => void;
  /**
   * Move an image button so its top-left slot is `position` of `toMenuId`, a menu of the
   * same Project (its own menu or another one, whose grid may differ). It keeps its size,
   * its texts (rekeyed to the new menu) and its id, renamed only when the target menu
   * already has it. Throws, changing nothing, when the rectangle leaves the target grid
   * or covers another element. Returns the element's id in the target menu.
   */
  moveImageButton: (input: {
    projectId: ProjectId;
    menuId: MenuId;
    elementId: ElementId;
    toMenuId: MenuId;
    position: number;
  }) => ElementId | undefined;
  /**
   * Move the item of slot `position` of an element (not an image button) to slot
   * `toPosition` of another menu of the Project. An element with that one slot moves
   * whole (its texts rekeyed, its id renamed only on a clash); one with several slots
   * leaves this one in a copy with its own texts. `copy`: the source keeps its slot. The
   * target slot is taken from whatever held it, unless an image button covers it (throws,
   * changing nothing). Returns the element's id in the target menu.
   */
  moveElementToMenu: (input: {
    projectId: ProjectId;
    menuId: MenuId;
    elementId: ElementId;
    position: number;
    toMenuId: MenuId;
    toPosition: number;
    copy?: boolean;
  }) => ElementId | undefined;
  /** Paste already-cloned-and-id-rewritten entities into a project at an offset. */
  pasteEntities: (input: {
    projectId: ProjectId;
    menus: Menu[];
    commands: Command[];
    offset: { x: number; y: number };
    /** The clipboard's translations, for entities copied from another Project. */
    texts?: Record<I18nKey, Record<string, string>>;
  }) => void;
}

export const createElementsSlice = ({
  mutateProject,
  mutateMenu,
  mutateElement,
  mutateAppearance,
  mutateClickHandler,
}: ProjectsSliceContext): ElementsSlice => {
  /** The `if` step at `ifStepIndex` under `frames` in an element's click handler. */
  const mutateIfStep = (
    input: AppearanceTarget & {
      projectId: ProjectId;
      appearanceIndex: number;
      clickType: ClickType;
      frames: StepFrame[];
      ifStepIndex: number;
    },
    fn: Mutation<[ifStep: Extract<Step, { kind: "if" }>, project: Project]>,
  ) =>
    mutateClickHandler(
      input.projectId,
      input,
      input.appearanceIndex,
      input.clickType,
      (handler, project) => {
        const ifStep = resolveParentMut(handler.steps, input.frames)?.[input.ifStepIndex];
        if (!ifStep || ifStep.kind !== "if") return false;
        return fn(ifStep, project);
      },
    );

  return {
    setElementIterates: ({ projectId: pId, menuId: mId, elementId: eId, iterates }) =>
      mutateElement(pId, mId, eId, (el) => {
        el.iterates = iterates;
        if (iterates) el.places = undefined; // XOR: iterates and places are exclusive
      }),
    setElementPlaces: ({ projectId: pId, menuId: mId, elementId: eId, places }) =>
      mutateElement(pId, mId, eId, (el) => {
        el.places = places;
        if (places) el.iterates = undefined; // XOR: exclusive with iteration
      }),
    setElementPlacement: ({ projectId: pId, menuId: mId, elementId: eId, placement }) =>
      mutateElement(pId, mId, eId, (el) => {
        if (!el.places) return false;
        const list = el.places.placements;
        const i = list.findIndex((p) => p.key === placement.key);
        if (i >= 0) list[i] = placement;
        else list.push(placement);
      }),
    removeElementPlacement: ({ projectId: pId, menuId: mId, elementId: eId, key }) =>
      mutateElement(pId, mId, eId, (el) => {
        if (!el.places) return false;
        el.places.placements = el.places.placements.filter((p) => p.key !== key);
      }),
    setElementId: ({ projectId: pId, menuId: mId, oldId, newId }) => {
      if (oldId === newId) return;
      if (!newId) throw new Error("element id cannot be empty");
      mutateMenu(pId, mId, (menu, project) => {
        if (findElement(menu, newId)) {
          throw new Error(`element id "${newId}" already exists in menu`);
        }
        const el = findElement(menu, oldId);
        if (!el) return false;
        el.id = newId;
        rekeyMenu(project, menu);
      });
    },
    setSlotMaterial: ({ projectId: pId, menuId: mId, position, material }) =>
      mutateMenu(pId, mId, (menu, project) => {
        // Find the element that currently owns this position (single OR
        // multi-pos), update its material — preserves title/lore/count.
        for (const layer of menu.layers) {
          for (const el of layer.elements) {
            if (!positionsContains(el.positions, position)) continue;
            if (hasImageButton(el))
              throw new Error("Change the image button's appearance in its properties.");
            const appearance = el.display;
            if (appearance) appearance.material = material;
            return;
          }
        }
        let firstLayer: Layer | undefined = menu.layers[0];
        if (!firstLayer) {
          firstLayer = { id: newLayerId(), name: "default", elements: [] };
          menu.layers.push(firstLayer);
        }
        firstLayer.elements.push({
          id: nextElementIdForMaterial(project, material),
          positions: String(position),
          display: { material },
          states: [],
        });
      }),
    setAppearanceImage: (input) =>
      mutateElement(input.projectId, input.menuId, input.elementId, (element, menu) => {
        const appearance = appearanceAt(element, input.appearanceIndex ?? 0);
        if (!appearance) return false;
        if (input.image) {
          assertImageButtonPlacement(menu, element, input.positions ?? element.positions);
          if (input.positions !== undefined) element.positions = input.positions;
          appearance.image = input.image;
          for (const field of ["material", "item", "head"])
            Reflect.deleteProperty(appearance, field);
        } else {
          Reflect.deleteProperty(appearance, "image");
        }
      }),
    setAppearanceField: (input) => {
      const { projectId: pId, appearanceIndex = 0, field, value } = input;
      mutateAppearance(pId, input, appearanceIndex, (appearance) => {
        if (field === "title" || field === "lore") {
          if (value !== undefined) return false;
          appearance[field] = undefined;
          if (field === "lore") appearance.loreMode = undefined;
        } else if (field === "loreMode") {
          appearance.loreMode = value === "replace" ? "replace" : undefined;
        } else if (field === "count") {
          if (value === undefined || value === "") {
            appearance.count = undefined;
          } else {
            const n = typeof value === "number" ? value : Number(value);
            if (!Number.isInteger(n) || n < 1 || n > 64) return false;
            appearance.count = n;
          }
        } else if (field === "material") {
          if (typeof value !== "string") return false;
          appearance.material = value || undefined;
          appearance.item = undefined;
          appearance.image = undefined;
          dropImageParts(appearance);
        } else if (field === "item") {
          if (typeof value !== "string") return false;
          appearance.item = value;
          appearance.material = undefined;
          appearance.image = undefined;
          dropImageParts(appearance);
        } else if (field === "head") {
          if (typeof value !== "string") return false;
          appearance.head = value || undefined;
        }
      });
    },
    setAppearanceAdvanced: (input) => {
      const { projectId: pId, appearanceIndex = 0, patch } = input;
      mutateAppearance(pId, input, appearanceIndex, (appearance) => {
        for (const [key, value] of Object.entries(patch)) {
          // An explicit `undefined` clears the field rather than storing a hole.
          if (value === undefined) delete (appearance as Record<string, unknown>)[key];
          else (appearance as Record<string, unknown>)[key] = value;
        }
      });
    },
    setAppearanceTitle: (input) => {
      const { projectId: pId, appearanceIndex = 0, lang, value } = input;
      mutateAppearance(pId, input, appearanceIndex, (appearance, project) => {
        // Lazy-allocate: brand-new appearances start with no title
        // LText, so the first edit creates one. If the user clears
        // the field, we keep the LText (they may want to re-edit
        // or translate it later) but write "" into the active lang.
        if (!appearance.title)
          appearance.title = createLTextAt(
            project,
            appearanceTitleKeyFor(input, appearanceIndex),
            value,
            lang,
          );
        else setLText(project, appearance.title, lang, value);
      });
    },
    setAppearanceLabelText: (input) => {
      const { projectId: pId, appearanceIndex = 0, lang, value } = input;
      mutateAppearance(pId, input, appearanceIndex, (appearance, project) => {
        if (!appearance.label)
          appearance.label = {
            text: createLTextAt(
              project,
              appearanceLabelKeyFor(input, appearanceIndex),
              value,
              lang,
            ),
          };
        else setLText(project, appearance.label.text, lang, value);
      });
    },
    setAppearanceLabel: (input) => {
      const { projectId: pId, appearanceIndex = 0, patch } = input;
      mutateAppearance(pId, input, appearanceIndex, (appearance) => {
        if (patch === null) {
          appearance.label = undefined;
          return;
        }
        if (!appearance.label) return false;
        const next = { ...appearance.label, ...patch };
        for (const [key, value] of Object.entries(patch))
          if (value === undefined) Reflect.deleteProperty(next, key);
        appearance.label = next;
      });
    },
    setAppearanceComponent: (input) =>
      mutateElement(input.projectId, input.menuId, input.elementId, (element) => {
        const appearance = appearanceAt(element, input.appearanceIndex ?? 0);
        if (!appearance) return false;
        if (input.component === null) {
          Reflect.deleteProperty(appearance, "component");
          return;
        }
        if (element.iterates || element.places)
          throw new Error("A component needs a fixed element.");
        appearance.component = input.component;
        for (const key of ["image", "label", "parts", "item", "material", "head"] as const)
          Reflect.deleteProperty(appearance, key);
      }),
    detachAppearanceComponent: (input) =>
      mutateElement(input.projectId, input.menuId, input.elementId, (element, _menu, project) => {
        const appearance = appearanceAt(element, input.appearanceIndex ?? 0);
        if (!appearance || appearance.component === undefined) return false;
        const parts: LookParts = [];
        for (const image of input.look.images)
          parts.push({
            image: image.asset,
            ...((image.fit ?? "native") !== "native" ? { fit: image.fit } : {}),
            ...(image.anchor && image.anchor !== "center" ? { anchor: image.anchor } : {}),
            ...(image.offset_x ? { offset_x: image.offset_x } : {}),
            ...(image.offset_y ? { offset_y: image.offset_y } : {}),
          });
        for (const label of input.look.labels) {
          const texts =
            typeof label.text === "string" ? { [input.lang]: label.text } : { ...label.text };
          const [first, ...rest] = Object.entries(texts);
          const text = createLText(project, first?.[1] ?? "", first?.[0] ?? input.lang);
          for (const [lang, value] of rest) setLText(project, text, lang, value);
          const h = label.align ?? "center";
          const v = label.valign ?? "center";
          const anchor = (v === "center" ? h : h === "center" ? v : `${v}_${h}`) as PartAnchor;
          parts.push({
            label: text,
            ...(anchor !== "center" ? { anchor } : {}),
            ...(label.size ? { size: label.size } : {}),
            ...(label.offset_x ? { offset_x: label.offset_x } : {}),
            ...(label.offset_y ? { offset_y: label.offset_y } : {}),
          });
        }
        Reflect.deleteProperty(appearance, "component");
        if (parts.length) appearance.parts = parts;
      }),
    writeComponent: (input) =>
      mutateProject(input.projectId, (project) => {
        if (!/^[a-z0-9][a-z0-9_.-]*$/.test(input.name))
          throw new Error("A component's name is lowercase letters, digits, `_`, `-` and `.`.");
        if (!project.moduleData) project.moduleData = {};
        const data = project.moduleData as Record<
          string,
          { __files?: Record<string, string> } | undefined
        >;
        if (!data.components) data.components = {};
        if (!data.components.__files) data.components.__files = {};
        const files = data.components.__files;
        const held = [`${input.name}.yml`, `${input.name}.yaml`].find((file) => file in files);
        if (input.content === null) {
          if (!held) return false;
          Reflect.deleteProperty(files, held);
          return;
        }
        if (input.create && held) throw new Error(`A component "${input.name}" already exists.`);
        files[held ?? `${input.name}.yml`] = input.content;
      }),
    saveLookAsComponent: (input) =>
      mutateElement(input.projectId, input.menuId, input.elementId, (element, _menu, project) => {
        const appearance = appearanceAt(element, input.appearanceIndex ?? 0);
        if (!appearance || appearance.component !== undefined) return false;
        if (!/^[a-z0-9][a-z0-9_.-]*$/.test(input.name))
          throw new Error("A component's name is lowercase letters, digits, `_`, `-` and `.`.");
        const parts = appearance.parts ?? partsOfLook(appearance);
        if (!parts.length) throw new Error("This look draws nothing to save.");
        if (!project.moduleData) project.moduleData = {};
        const data = project.moduleData as Record<
          string,
          { __files?: Record<string, string> } | undefined
        >;
        if (!data.components) data.components = {};
        if (!data.components.__files) data.components.__files = {};
        const files = data.components.__files;
        if (`${input.name}.yml` in files || `${input.name}.yaml` in files)
          throw new Error(`A component "${input.name}" already exists.`);
        const written = parts.map((part) => {
          if ("image" in part) return part;
          const { label, ...placement } = part;
          const texts = Object.entries(project.i18nKeys[label.key] ?? {}).filter(
            ([, value]) => typeof value === "string" && value !== "",
          );
          deleteLText(project, label);
          return {
            label: texts.length <= 1 ? (texts[0]?.[1] ?? "") : Object.fromEntries(texts),
            ...placement,
          };
        });
        files[`${input.name}.yml`] = stringify({ parts: written });
        appearance.component = input.name;
        for (const key of ["image", "label", "parts"] as const)
          Reflect.deleteProperty(appearance, key);
      }),
    editAppearanceParts: (input) =>
      mutateElement(input.projectId, input.menuId, input.elementId, (element, menu, project) => {
        const appearance = appearanceAt(element, input.appearanceIndex ?? 0);
        if (!appearance) return false;
        const op = input.op;
        const parts: LookParts = appearance.parts ?? partsOfLook(appearance);
        const at = "index" in op ? parts[op.index] : undefined;
        if ("index" in op && !at) return false;
        if (op.type === "addImage") {
          if (!parts.some((part) => "image" in part))
            assertImageButtonPlacement(menu, element, op.positions ?? element.positions);
          if (op.positions !== undefined) element.positions = op.positions;
          parts.push({ image: op.asset });
        } else if (op.type === "addLabel") {
          if (element.iterates || element.places)
            throw new Error("A look of parts needs a fixed element.");
          parts.push({ label: createLText(project, "", op.lang) });
        } else if (op.type === "patch" && at) {
          for (const [key, value] of Object.entries(op.patch)) {
            if (value === undefined) Reflect.deleteProperty(at, key);
            else (at as Record<string, unknown>)[key] = value;
          }
        } else if (op.type === "text" && at) {
          if ("image" in at) return false;
          setLText(project, at.label, op.lang, op.value);
        } else if (op.type === "move" && at) {
          const to = Math.max(0, Math.min(parts.length - 1, op.to));
          if (to === op.index) return false;
          parts.splice(op.index, 1);
          parts.splice(to, 0, at);
        } else if (op.type === "remove" && at) {
          if (!("image" in at)) deleteLText(project, at.label);
          parts.splice(op.index, 1);
        }
        Reflect.deleteProperty(appearance, "image");
        Reflect.deleteProperty(appearance, "label");
        if (parts.length) appearance.parts = parts;
        else Reflect.deleteProperty(appearance, "parts");
        // A look that draws images names no item: its slots hold the invisible hit item.
        if (parts.some((part) => "image" in part))
          for (const field of ["material", "item", "head"])
            Reflect.deleteProperty(appearance, field);
      }),
    setElementRefresh: ({ projectId: pId, menuId: mId, elementId, ticks }) =>
      mutateElement(pId, mId, elementId, (el) => {
        const clamped = clampRefreshTicks(ticks);
        if (clamped === undefined) Reflect.deleteProperty(el, "refreshTicks");
        else el.refreshTicks = clamped;
      }),
    setElementPositions: ({ projectId: pId, menuId: mId, elementId, positions }) =>
      mutateElement(pId, mId, elementId, (el, menu) => {
        if (hasImageButton(el)) assertImageButtonPlacement(menu, el, positions);
        for (const other of menu.layers.flatMap((l) => l.elements)) {
          if (
            other.id !== el.id &&
            hasImageButton(other) &&
            parsePositions(other.positions).some((slot) => positionsContains(positions, slot))
          ) {
            throw new Error("This area belongs to an image button.");
          }
        }
        el.positions = positions;
      }),
    moveElementPosition: ({ projectId: pId, menuId: mId, elementId, fromPosition, toPosition }) =>
      mutateMenu(pId, mId, (menu) => {
        const imageElement = findElement(menu, elementId);
        if (imageElement && hasImageButton(imageElement)) {
          const type = menu.inventoryType ?? "chest";
          const rect = imageButtonRect(
            imageElement.positions,
            type,
            menu.rows,
            menu.playerInventory,
          );
          if (!rect) throw new Error("Invalid image button area.");
          // Move the rectangle by the drag delta on the visual grid (menu
          // rows, then the player rows when the bottom is hidden).
          const origin = positionToCell(rect.slot, type, menu.rows);
          const from = positionToCell(fromPosition, type, menu.rows);
          const to = positionToCell(toPosition, type, menu.rows);
          const target = cellToPosition(
            { col: origin.col + to.col - from.col, row: origin.row + to.row - from.row },
            type,
            menu.rows,
            menu.playerInventory,
          );
          if (target === null) throw new Error("The image button must fit inside the menu.");
          const positions = rectanglePositions(
            target,
            rect.width,
            rect.height,
            type,
            menu.rows,
            menu.playerInventory,
          );
          assertImageButtonPlacement(menu, imageElement, positions);
          imageElement.positions = positions;
          return;
        }
        for (const other of menu.layers.flatMap((l) => l.elements)) {
          if (hasImageButton(other) && positionsContains(other.positions, toPosition))
            throw new Error("This area belongs to an image button.");
        }
        // First, strip toPosition from any element that owns it.
        for (const layer of menu.layers) {
          for (const otherEl of layer.elements) {
            if (otherEl.id === elementId) continue;
            if (positionsContains(otherEl.positions, toPosition)) {
              otherEl.positions = removePosition(otherEl.positions, toPosition);
            }
          }
          layer.elements = layer.elements.filter((el) => el.places || el.positions !== "");
        }
        // Then update the source element: remove from, add to.
        const el = findElement(menu, elementId);
        if (!el) return false;
        el.positions = addPosition(removePosition(el.positions, fromPosition), toPosition);
      }),
    addElementPosition: ({ projectId: pId, menuId: mId, elementId, position }) =>
      mutateMenu(pId, mId, (menu) => {
        const source = findElement(menu, elementId);
        if (source && hasImageButton(source))
          assertImageButtonPlacement(menu, source, addPosition(source.positions, position));
        for (const other of menu.layers.flatMap((l) => l.elements)) {
          if (
            other.id !== elementId &&
            hasImageButton(other) &&
            positionsContains(other.positions, position)
          )
            throw new Error("This area belongs to an image button.");
        }
        for (const layer of menu.layers) {
          for (const otherEl of layer.elements) {
            if (otherEl.id === elementId) continue;
            if (positionsContains(otherEl.positions, position)) {
              otherEl.positions = removePosition(otherEl.positions, position);
            }
          }
          layer.elements = layer.elements.filter((el) => el.places || el.positions !== "");
        }
        const el = findElement(menu, elementId);
        if (!el) return false;
        el.positions = addPosition(el.positions, position);
      }),
    deleteElement: ({ projectId: pId, menuId: mId, elementId }) =>
      mutateMenu(pId, mId, (menu, project) => {
        for (const layer of menu.layers) {
          const idx = layer.elements.findIndex((el) => el.id === elementId);
          if (idx !== -1) {
            gcElementLTexts(project, layer.elements[idx]!);
            layer.elements.splice(idx, 1);
            return;
          }
        }
        return false;
      }),
    setElementStep: (input) => {
      const { projectId: pId, appearanceIndex, clickType, path, step, lang } = input;
      mutateClickHandler(pId, input, appearanceIndex, clickType, (handler, project) => {
        const parent = resolveParentMut(handler.steps, path.frames);
        if (!parent || path.index < 0 || path.index >= parent.length) return false;
        gcStepLTexts(project, [parent[path.index]!]);
        parent[path.index] = step;
        allocStepLTexts(
          project,
          handler.steps,
          lang,
          appearanceClickPrefixFor(input, appearanceIndex, clickType),
        );
      });
    },
    addElementStep: (input) => {
      const { projectId: pId, appearanceIndex, clickType, frames, index, step, lang } = input;
      mutateClickHandler(pId, input, appearanceIndex, clickType, (handler, project) => {
        const parent = resolveParentMut(handler.steps, frames);
        if (!parent) return false;
        const at = index < 0 || index > parent.length ? parent.length : index;
        parent.splice(at, 0, step);
        allocStepLTexts(
          project,
          handler.steps,
          lang,
          appearanceClickPrefixFor(input, appearanceIndex, clickType),
        );
      });
    },
    removeElementStep: (input) => {
      const { projectId: pId, appearanceIndex, clickType, path } = input;
      mutateClickHandler(pId, input, appearanceIndex, clickType, (handler, project) => {
        const parent = resolveParentMut(handler.steps, path.frames);
        if (!parent || path.index < 0 || path.index >= parent.length) return false;
        gcStepLTexts(project, [parent[path.index]!]);
        parent.splice(path.index, 1);
      });
    },
    moveElementStep: (input) => {
      const { projectId: pId, appearanceIndex, clickType, from, to } = input;
      mutateClickHandler(pId, input, appearanceIndex, clickType, (handler) => {
        if (!moveStepMut(handler.steps, from, to)) return false;
      });
    },
    addIfCase: (input) =>
      mutateIfStep(input, (ifStep) => {
        ifStep.cases.push({ conditions: [], steps: [] });
      }),
    removeIfCase: (input) =>
      mutateIfStep(input, (ifStep, project) => {
        const { caseIndex } = input;
        if (caseIndex < 0 || caseIndex >= ifStep.cases.length) return false;
        gcStepLTexts(project, ifStep.cases[caseIndex]!.steps);
        ifStep.cases.splice(caseIndex, 1);
      }),
    setIfCaseConditions: (input) =>
      mutateIfStep(input, (ifStep) => {
        const c = ifStep.cases[input.caseIndex];
        if (!c) return false;
        c.conditions = input.conditions;
      }),
    setIfCaseJoin: (input) =>
      mutateIfStep(input, (ifStep) => {
        const { caseIndex, joinIndex, op } = input;
        const c = ifStep.cases[caseIndex];
        if (!c) return false;
        const max = Math.max(0, c.conditions.length - 1);
        if (joinIndex < 0 || joinIndex >= max) return false;
        if (!c.joins) c.joins = Array(max).fill("and");
        while (c.joins.length < max) c.joins.push("and");
        c.joins[joinIndex] = op;
      }),
    toggleIfElse: (input) =>
      mutateIfStep(input, (ifStep, project) => {
        if (input.enabled) {
          if (!ifStep.else) ifStep.else = [];
        } else {
          if (ifStep.else) gcStepLTexts(project, ifStep.else);
          ifStep.else = undefined;
        }
      }),
    addElementClickHandler: (input) => {
      const { projectId: pId, appearanceIndex, clickType } = input;
      mutateAppearance(pId, input, appearanceIndex, (appearance) => {
        if (!appearance.click) appearance.click = {};
        if (appearance.click[clickType]) return false;
        appearance.click[clickType] = { steps: [] };
      });
    },
    removeElementClickHandler: (input) => {
      const { projectId: pId, appearanceIndex, clickType } = input;
      mutateAppearance(pId, input, appearanceIndex, (appearance, project) => {
        if (!appearance.click) return false;
        const handler = appearance.click[clickType];
        if (handler) gcStepLTexts(project, handler.steps);
        delete appearance.click[clickType];
      });
    },
    addAppearance: (input) =>
      mutateElement(input.projectId, input.menuId, input.elementId, (owner) => {
        // A new state starts EMPTY — it is a whole appearance, not a patch,
        // and the bare stone block it renders says so at a glance (ADR
        // `element-display-and-states`). Duplicating the display is the
        // separate "duplicate" affordance. The placeholder condition keeps
        // it from matching, and so from shadowing the display.
        owner.states.push({ if: [{ type: "has_permission", perm: "" }] });
      }),
    duplicateAppearance: (input) =>
      mutateElement(input.projectId, input.menuId, input.elementId, (owner, _menu, project) => {
        const source = appearanceAt(owner, input.appearanceIndex);
        if (!source) return false;
        const copy = structuredClone(current(source)) as Appearance;
        cloneAppearanceLTextsInto(project, copy);
        // A duplicate of the display would match always and shadow it, so
        // it carries the same placeholder guard a fresh state gets.
        if (!copy.if || copy.if.length === 0) {
          copy.if = [{ type: "has_permission", perm: "" }];
        }
        owner.states.push(copy);
      }),
    removeAppearance: (input) =>
      mutateElement(input.projectId, input.menuId, input.elementId, (owner, _menu, project) => {
        const { appearanceIndex } = input;
        // Index 0 is the display — an Element always has one, so only
        // states are removable.
        if (appearanceIndex < 1 || appearanceIndex > owner.states.length) return false;
        gcAppearanceLTexts(project, owner.states[appearanceIndex - 1]!);
        owner.states.splice(appearanceIndex - 1, 1);
      }),
    moveAppearance: (input) =>
      mutateElement(input.projectId, input.menuId, input.elementId, (owner) => {
        const { fromIndex, toIndex } = input;
        // Only states reorder: the display is neither first nor last in
        // resolution order, it is the fallback.
        if (
          fromIndex < 1 ||
          fromIndex > owner.states.length ||
          toIndex < 1 ||
          toIndex > owner.states.length
        )
          return false;
        const [moved] = owner.states.splice(fromIndex - 1, 1);
        if (moved) owner.states.splice(toIndex - 1, 0, moved);
      }),
    setAppearanceConditions: (input) => {
      const { projectId: pId, appearanceIndex, conditions } = input;
      mutateAppearance(pId, input, appearanceIndex, (appearance) => {
        appearance.if = conditions.length > 0 ? conditions : undefined;
        // Trim joins past the new conditions length so the array
        // doesn't carry stale entries when conditions shrink.
        const maxJoins = Math.max(0, conditions.length - 1);
        if (appearance.ifJoins) {
          if (maxJoins === 0) appearance.ifJoins = undefined;
          else if (appearance.ifJoins.length > maxJoins) appearance.ifJoins.length = maxJoins;
        }
      });
    },
    setAppearanceJoin: (input) => {
      const { projectId: pId, appearanceIndex, joinIndex, op } = input;
      mutateAppearance(pId, input, appearanceIndex, (appearance) => {
        const max = Math.max(0, (appearance.if?.length ?? 0) - 1);
        if (joinIndex < 0 || joinIndex >= max) return false;
        if (!appearance.ifJoins) appearance.ifJoins = Array(max).fill("and");
        while (appearance.ifJoins.length < max) appearance.ifJoins.push("and");
        appearance.ifJoins[joinIndex] = op;
      });
    },
    addImageButton: ({ projectId: pId, menuId: mId, position, asset }) => {
      let created: ElementId | undefined;
      mutateMenu(pId, mId, (menu, project) => {
        const size = imageButtonSize(asset.width, asset.height);
        const element: Element = {
          id: nextElementIdForMaterial(project, undefined),
          positions: rectanglePositions(
            position,
            size.width,
            size.height,
            menu.inventoryType ?? "chest",
            menu.rows,
            menu.playerInventory,
          ),
          display: { image: { asset: asset.id, fit: "native" } },
          states: [],
        };
        assertImageButtonPlacement(menu, element);
        if (!menu.layers.length)
          menu.layers.push({ id: newLayerId(), name: "default", elements: [] });
        menu.layers[0]!.elements.push(element);
        created = element.id;
      });
      return created;
    },
    addElement: ({ projectId: pId, menuId: mId, element, texts }) =>
      mutateMenu(pId, mId, (menu, project) => {
        const lent = lendTexts(project, texts);
        const newPositions = parsePositions(element.positions);
        for (const layer of menu.layers) {
          for (const otherEl of layer.elements) {
            for (const p of newPositions) {
              if (positionsContains(otherEl.positions, p)) {
                otherEl.positions = removePosition(otherEl.positions, p);
              }
            }
          }
          layer.elements = layer.elements.filter((el) => el.places || el.positions !== "");
        }
        let firstLayer: Layer | undefined = menu.layers[0];
        if (!firstLayer) {
          firstLayer = { id: newLayerId(), name: "default", elements: [] };
          menu.layers.push(firstLayer);
        }
        // Renumber the id following the material_N scheme so paste/duplicate
        // doesn't leak the random `el_<n>_<ts>` id from the clipboard. The
        // raw nanoid would surface in YAML files and breaks the visual
        // grouping admins rely on (`diamond_sword_1`, `_2`, …).
        const materialForId = element.display.material ?? undefined;
        const renumberedId = nextElementIdForMaterial(project, materialForId);
        // Clone LText keys so the added element never shares keys with its source.
        // Without this, rekeyProject at deploy time would delete the shared key,
        // breaking the original element's translations.
        const elementToAdd: Element = {
          ...element,
          id: renumberedId,
          positions: formatPositions(newPositions),
          ...(() => {
            const cloneAppearance = (a: Appearance): Appearance => {
              const cloned = { ...a };
              if (a.title) {
                const src = project.i18nKeys[a.title.key];
                cloned.title = createLText(project, "", project.defaultLang);
                if (src) project.i18nKeys[cloned.title.key] = { ...src };
              }
              if (a.lore) {
                const src = project.i18nKeys[a.lore.key];
                cloned.lore = createLText(project, "", project.defaultLang);
                if (src) project.i18nKeys[cloned.lore.key] = { ...src };
              }
              if (a.click) {
                const click = { ...a.click };
                for (const handler of Object.values(click)) {
                  if (handler) duplicateStepLTexts(project, handler.steps);
                }
                cloned.click = click;
              }
              return cloned;
            };
            return {
              display: cloneAppearance(element.display),
              states: element.states.map(cloneAppearance),
            };
          })(),
        };
        firstLayer.elements.push(elementToAdd);
        returnTexts(project, lent);
      }),
    moveSelectionByDelta: ({ projectId: pId, menuId: mId, elementIds, dCol, dRow }) =>
      mutateMenu(pId, mId, (menu) => {
        const targetSet = new Set(elementIds);
        // Grid is type-dependent: chest 9×rows, hopper 5×1, dropper 3×3, then
        // the 4 player rows (9 columns) when the bottom is hidden.
        const type = menu.inventoryType ?? "chest";
        // First pass: compute new positions and validate bounds.
        const plans = new Map<ElementId, number[]>();
        for (const layer of menu.layers) {
          for (const el of layer.elements) {
            if (!targetSet.has(el.id)) continue;
            const newPositions: number[] = [];
            for (const p of parsePositions(el.positions)) {
              const cell = positionToCell(p, type, menu.rows);
              const target = cellToPosition(
                { col: cell.col + dCol, row: cell.row + dRow },
                type,
                menu.rows,
                menu.playerInventory,
              );
              if (target === null) throw new Error("selection drag would land outside the menu");
              newPositions.push(target);
            }
            plans.set(el.id, newPositions);
          }
        }
        if (plans.size === 0) return false;
        for (const el of menu.layers.flatMap((l) => l.elements)) {
          const plan = plans.get(el.id);
          if (plan && hasImageButton(el))
            assertImageButtonPlacement(menu, el, formatPositions(plan), targetSet);
          if (
            !plan &&
            hasImageButton(el) &&
            [...plans.values()].flat().some((slot) => positionsContains(el.positions, slot))
          ) {
            throw new Error("This area belongs to an image button.");
          }
        }
        // Strip new positions from non-target elements (takeover).
        const claimed = new Set<number>();
        for (const ps of plans.values()) for (const p of ps) claimed.add(p);
        for (const layer of menu.layers) {
          for (const otherEl of layer.elements) {
            if (targetSet.has(otherEl.id)) continue;
            const filtered = parsePositions(otherEl.positions).filter((p) => !claimed.has(p));
            otherEl.positions = formatPositions(filtered);
          }
          layer.elements = layer.elements.filter((el) => el.places || el.positions !== "");
        }
        // Apply new positions to target elements.
        for (const layer of menu.layers) {
          for (const el of layer.elements) {
            const plan = plans.get(el.id);
            if (plan) el.positions = formatPositions(plan);
          }
        }
      }),
    moveImageButton: ({ projectId: pId, menuId: mId, elementId: eId, toMenuId, position }) => {
      let moved: ElementId | undefined;
      mutateProject(pId, (project) => {
        const menus = mutableMenus(project);
        const from = menus.find((menu) => menu.id === mId);
        const to = menus.find((menu) => menu.id === toMenuId);
        const layer = from?.layers.find((l) => l.elements.some((el) => el.id === eId));
        const element = layer?.elements.find((el) => el.id === eId);
        if (!from || !to || !layer || !element) return false;
        const rect = imageButtonRect(
          element.positions,
          from.inventoryType ?? "chest",
          from.rows,
          from.playerInventory,
        );
        if (!rect || !hasImageButton(element)) throw new Error("Not an image button.");
        const positions = rectanglePositions(
          position,
          rect.width,
          rect.height,
          to.inventoryType ?? "chest",
          to.rows,
          to.playerInventory,
        );
        if (from === to) {
          if (positions === element.positions) return false;
          assertImageButtonPlacement(to, element, positions);
          element.positions = positions;
          moved = eId;
          return;
        }
        const id = findElement(to, eId)
          ? nextElementIdForMaterial(project, element.display.material ?? undefined)
          : eId;
        // A deep copy: `current` shares the untouched subtrees (its texts) with the frozen state.
        const next: Element = { ...structuredClone(current(element)), id, positions };
        assertImageButtonPlacement(to, next);
        layer.elements = layer.elements.filter((el) => el.id !== eId);
        if (!to.layers.length) to.layers.push({ id: newLayerId(), name: "default", elements: [] });
        to.layers[0]!.elements.push(next);
        rekeyMenu(project, to);
        moved = id;
      });
      return moved;
    },
    moveElementToMenu: ({
      projectId: pId,
      menuId: mId,
      elementId: eId,
      position,
      toMenuId,
      toPosition,
      copy = false,
    }) => {
      let moved: ElementId | undefined;
      mutateProject(pId, (project) => {
        const menus = mutableMenus(project);
        const from = menus.find((menu) => menu.id === mId);
        const to = menus.find((menu) => menu.id === toMenuId);
        const layer = from?.layers.find((l) => l.elements.some((el) => el.id === eId));
        const element = layer?.elements.find((el) => el.id === eId);
        if (!from || !to || from === to || !layer || !element) return false;
        if (
          hasImageButton(element) ||
          element.places ||
          !positionsContains(element.positions, position)
        )
          return false;
        if (
          toPosition < 0 ||
          toPosition >= positionCount(to.inventoryType ?? "chest", to.rows, to.playerInventory)
        )
          throw new Error("The slot is outside the menu.");
        for (const other of to.layers.flatMap((l) => l.elements)) {
          if (hasImageButton(other) && positionsContains(other.positions, toPosition))
            throw new Error("This area belongs to an image button.");
        }
        const whole = !copy && parsePositions(element.positions).length === 1;
        // A deep copy: `current` shares the untouched subtrees (its texts) with the frozen state.
        const next: Element = {
          ...structuredClone(current(element)),
          positions: String(toPosition),
        };
        if (whole) {
          if (findElement(to, eId))
            next.id = nextElementIdForMaterial(project, element.display.material ?? undefined);
        } else {
          next.id = nextElementIdForMaterial(project, element.display.material ?? undefined);
          // The copy gets its own texts, so editing one never changes the other.
          for (const appearance of addressedAppearances(next)) {
            cloneAppearanceLTextsInto(project, appearance);
          }
        }
        for (const targetLayer of to.layers) {
          for (const other of targetLayer.elements) {
            if (positionsContains(other.positions, toPosition))
              other.positions = removePosition(other.positions, toPosition);
          }
          targetLayer.elements = targetLayer.elements.filter(
            (el) => el.places || el.positions !== "",
          );
        }
        if (whole) layer.elements = layer.elements.filter((el) => el.id !== eId);
        else if (!copy) element.positions = removePosition(element.positions, position);
        if (!to.layers.length) to.layers.push({ id: newLayerId(), name: "default", elements: [] });
        to.layers[0]!.elements.push(next);
        rekeyMenu(project, to);
        moved = next.id;
      });
      return moved;
    },
    setAppearanceLore: (input) => {
      const { projectId: pId, appearanceIndex = 0, lang, value } = input;
      mutateAppearance(pId, input, appearanceIndex, (appearance, project) => {
        if (appearance.loreMode === "replace") {
          if (!appearance.lore)
            appearance.lore = createLTextAt(
              project,
              appearanceLoreKeyFor(input, appearanceIndex),
              value,
              lang,
            );
          else setLText(project, appearance.lore, lang, value);
        } else if (!appearance.lore) {
          appearance.lore = value
            ? createLTextAt(project, appearanceLoreKeyFor(input, appearanceIndex), value, lang)
            : undefined;
        } else if (value) {
          setLText(project, appearance.lore, lang, value);
        } else {
          deleteLText(project, appearance.lore);
          appearance.lore = undefined;
        }
      });
    },
    clearSlot: ({ projectId: pId, menuId: mId, position }) =>
      mutateMenu(pId, mId, (menu, project) => {
        for (const layer of menu.layers) {
          const idx = layer.elements.findIndex((el) => positionsContains(el.positions, position));
          if (idx === -1) continue;
          const el = layer.elements[idx]!;
          const remaining = removePosition(el.positions, position);
          if (remaining === "" || hasImageButton(el)) {
            // Last position — drop the element entirely.
            gcElementLTexts(project, el);
            layer.elements.splice(idx, 1);
          } else {
            el.positions = remaining;
          }
          return;
        }
        return false;
      }),
    pasteEntities: ({ projectId: pId, menus, commands, offset, texts }) =>
      mutateProject(
        pId,
        (project) => {
          const lent = lendTexts(project, texts);
          // Clone every LText held by the pasted entities under fresh
          // keys, copying the value map from the source. Otherwise the
          // copies would share keys with the originals — editing one
          // would silently alter the other.
          const cloneAppearanceLTexts = (a: Appearance) => cloneAppearanceLTextsInto(project, a);
          for (const m of menus) {
            const stamped: Menu = { ...m, projectId: pId };
            // Clone each text layer's LText under a fresh key, copying the
            // value map so the pasted copy doesn't share keys with the original.
            stamped.title = stamped.title.map((titleLayer) => {
              if (!("value" in titleLayer)) return titleLayer;
              const src = project.i18nKeys[titleLayer.value.key];
              const cloned = createLText(project, "", project.defaultLang);
              if (src) project.i18nKeys[cloned.key] = { ...src };
              return { ...titleLayer, value: cloned };
            });
            for (const layer of stamped.layers) {
              for (const el of layer.elements) {
                for (const a of addressedAppearances(el)) cloneAppearanceLTexts(a);
              }
            }
            mutableMenus(project).push(stamped);
            rekeyMenu(project, stamped);
            project.canvasLayout[docKey("menu", stamped.id)] = { x: offset.x, y: offset.y };
            offset.x += 24;
            offset.y += 24;
          }
          for (const c of commands) {
            const stamped: Command = { ...c, projectId: pId };
            duplicateStepLTexts(project, stamped.steps);
            mutableCommands(project).push(stamped);
            rekeyCommand(project, stamped);
            project.canvasLayout[docKey("command", stamped.id)] = { x: offset.x, y: offset.y };
            offset.x += 24;
            offset.y += 24;
          }
          returnTexts(project, lent);
        },
        // A paste has never stamped `updatedAt`; kept as is.
        { touch: false },
      ),
  };
};
