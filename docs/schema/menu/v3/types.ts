import type * as V2 from "../v2/types";
export * from "../v2/types";
export interface Appearance extends V2.Appearance { lore_mode?: "replace" }
export interface Element extends Omit<V2.Element, "states"> { lore_mode?: "replace"; states?: Appearance[] }
export interface Layer extends Omit<V2.Layer, "elements"> { elements: Element[] }
export interface Menu extends Omit<V2.Menu, "schema" | "layers" | "background"> {
 schema: "menu/v3"; layers: Layer[]; background?: Appearance;
}
