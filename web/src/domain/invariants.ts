import type { Action, Appearance, Element, MenuId, Pack, TemplateId } from "./types";

/** Throws if the pack contains any reference crossing its own boundary. */
export function assertPackHermetic(pack: Pack): void {
  const menuIds = new Set<MenuId>(pack.menus.map((m) => m.id));
  const templateIds = new Set<TemplateId>(pack.templates.map((t) => t.id));

  for (const menu of pack.menus) {
    for (const layer of menu.layers) {
      for (const el of layer.elements) {
        checkElement(el, menuIds, templateIds);
      }
    }
  }

  for (const cmd of pack.commands) {
    for (const action of cmd.actions) {
      checkAction(action, menuIds);
    }
  }
}

function checkElement(el: Element, menuIds: Set<MenuId>, templateIds: Set<TemplateId>): void {
  if (el.templateRef && !templateIds.has(el.templateRef.id)) {
    throw new Error(`cross-pack template_ref: ${el.templateRef.id} not in pack`);
  }
  for (const appearance of el.appearances) {
    checkAppearance(appearance, menuIds);
  }
}

function checkAppearance(appearance: Appearance, menuIds: Set<MenuId>): void {
  if (!appearance.click) return;
  for (const handler of Object.values(appearance.click)) {
    if (!handler) continue;
    for (const action of handler.actions) checkAction(action, menuIds);
    if (handler.fallback) for (const action of handler.fallback) checkAction(action, menuIds);
  }
}

function checkAction(action: Action, menuIds: Set<MenuId>): void {
  if (action.type === "open_menu" && !menuIds.has(action.menuId)) {
    throw new Error(`cross-pack open_menu: ${action.menuId} not in pack`);
  }
}
