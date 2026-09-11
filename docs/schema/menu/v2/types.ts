/** menu/v2 adds an explicit complete-item binding; v1 remains supported. */
import type * as V1 from "../v1/types";
export * from "../v1/types";
export interface Appearance extends V1.Appearance { item?: string }
export interface Element extends Omit<V1.Element, "states"> { item?: string; states?: Appearance[] }
export interface Layer extends Omit<V1.Layer, "elements"> { elements: Element[] }
export interface Menu extends Omit<V1.Menu, "schema" | "layers" | "background"> {
  schema: "menu/v2";
  layers: Layer[];
  background?: Appearance;
}
