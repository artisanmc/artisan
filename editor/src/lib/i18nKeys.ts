import { walkActions } from "@/domain/stepPath";
import type { Command, I18nKey, Menu, Pack } from "@/domain/types";

export const stateLabel = (i: number): string => (i === 0 ? "default" : `state${i}`);

export const menuTitleKey = (menuId: string): I18nKey =>
  `menus.${menuId}.title` as I18nKey;

export const elementTitleKey = (menuId: string, elementId: string, appIdx: number): I18nKey =>
  `menus.${menuId}.elements.${elementId}.${stateLabel(appIdx)}.title` as I18nKey;

export const elementLoreKey = (menuId: string, elementId: string, appIdx: number): I18nKey =>
  `menus.${menuId}.elements.${elementId}.${stateLabel(appIdx)}.lore` as I18nKey;

export const clickHandlerKeyPrefix = (
  menuId: string,
  elementId: string,
  appIdx: number,
  clickType: string,
): string =>
  `menus.${menuId}.elements.${elementId}.${stateLabel(appIdx)}.click.${clickType}`;

export const commandKeyPrefix = (commandId: string): string =>
  `commands.${commandId}`;

export const messageKeyAt = (prefix: string, idx: number): I18nKey =>
  (idx === 0 ? `${prefix}.message` : `${prefix}.message_${idx}`) as I18nKey;

export const showTitleKeyAt = (prefix: string, idx: number): I18nKey =>
  (idx === 0 ? `${prefix}.show_title` : `${prefix}.show_title_${idx}`) as I18nKey;

export const showSubtitleKeyAt = (prefix: string, idx: number): I18nKey =>
  (idx === 0 ? `${prefix}.show_subtitle` : `${prefix}.show_subtitle_${idx}`) as I18nKey;

/**
 * Walk a menu's LText tree and assign canonical semantic keys based on the
 * menu's current id + element ids + appearance indices. Safe to call inside
 * an immer producer. Idempotent: no-ops when key is already correct.
 */
export function rekeyMenuLTexts(pack: Pack, menu: Menu): void {
  // menu.title is now MenuTitleLayer[]; rekey each text layer's LText.
  // First text layer gets the canonical "menus.{id}.title" key;
  // subsequent text layers get "menus.{id}.title_1", "menus.{id}.title_2", etc.
  let extraIdx = 1;
  for (const layer of menu.title) {
    if (layer.kind === "text" || layer.kind === "textarea" || layer.kind === "plain") {
      const key = extraIdx === 1
        ? menuTitleKey(menu.id)
        : (`${menuTitleKey(menu.id)}_${extraIdx}` as I18nKey);
      moveLTextKey(pack, layer.value, key);
      extraIdx++;
    }
  }
  for (const layer of menu.layers) {
    for (const el of layer.elements) {
      el.appearances.forEach((app, appIdx) => {
        if (app.title) {
          moveLTextKey(pack, app.title, elementTitleKey(menu.id, el.id, appIdx));
        }
        if (app.lore) {
          moveLTextKey(pack, app.lore, elementLoreKey(menu.id, el.id, appIdx));
        }
        if (app.click) {
          for (const [clickType, handler] of Object.entries(app.click)) {
            if (!handler) continue;
            let msgIdx = 0;
            let titleIdx = 0;
            let subtitleIdx = 0;
            for (const action of walkActions(handler.steps)) {
              const prefix = clickHandlerKeyPrefix(menu.id, el.id, appIdx, clickType);
              if (action.type === "send_message") {
                moveLTextKey(pack, action.text, messageKeyAt(prefix, msgIdx));
                msgIdx++;
              } else if (action.type === "show_title") {
                moveLTextKey(pack, action.title, showTitleKeyAt(prefix, titleIdx));
                titleIdx++;
                if (action.subtitle) {
                  moveLTextKey(pack, action.subtitle, showSubtitleKeyAt(prefix, subtitleIdx));
                  subtitleIdx++;
                }
              }
            }
          }
        }
      });
    }
  }
}

/**
 * Walk a command's LText tree and assign canonical semantic keys.
 */
export function rekeyCommandLTexts(pack: Pack, cmd: Command): void {
  const prefix = commandKeyPrefix(cmd.id);
  let msgIdx = 0;
  let titleIdx = 0;
  let subtitleIdx = 0;
  for (const action of walkActions(cmd.steps)) {
    if (action.type === "send_message") {
      moveLTextKey(pack, action.text, messageKeyAt(prefix, msgIdx));
      msgIdx++;
    } else if (action.type === "show_title") {
      moveLTextKey(pack, action.title, showTitleKeyAt(prefix, titleIdx));
      titleIdx++;
      if (action.subtitle) {
        moveLTextKey(pack, action.subtitle, showSubtitleKeyAt(prefix, subtitleIdx));
        subtitleIdx++;
      }
    }
  }
}

export const dialogTitleKey = (dialogId: string): I18nKey =>
  `dialogs.${dialogId}.title` as I18nKey;

export const dialogBodyTextKey = (dialogId: string, index: number): I18nKey =>
  `dialogs.${dialogId}.body.${index}.text` as I18nKey;

export const dialogInputLabelKey = (dialogId: string, inputId: string): I18nKey =>
  `dialogs.${dialogId}.inputs.${inputId}.label` as I18nKey;

export const dialogOptionLabelKey = (dialogId: string, inputId: string, optionValue: string): I18nKey =>
  `dialogs.${dialogId}.inputs.${inputId}.options.${optionValue}.label` as I18nKey;

export const dialogButtonLabelKey = (dialogId: string, buttonId: string): I18nKey =>
  `dialogs.${dialogId}.buttons.${buttonId}.label` as I18nKey;

export const dialogButtonKeyPrefix = (dialogId: string, buttonId: string): string =>
  `dialogs.${dialogId}.buttons.${buttonId}`;

function moveLTextKey(pack: Pack, lt: { key: I18nKey }, newKey: I18nKey): void {
  if (lt.key === newKey) return;
  const value = pack.i18nKeys[lt.key];
  if (value) pack.i18nKeys[newKey] = value;
  delete pack.i18nKeys[lt.key];
  lt.key = newKey;
}
