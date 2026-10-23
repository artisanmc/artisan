/** Internal window CustomEvent: "open this element's individual view". Dispatched by board
 *  nodes on double-click; the workspace overview route listens and navigates. */
export const OPEN_ELEMENT_EVENT = "artisan:open_element";

export function dispatchOpenElement(id: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_ELEMENT_EVENT, { detail: { id } }));
}
