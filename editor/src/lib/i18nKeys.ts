import type { I18nKey, Project } from "@/domain/types";

export const stateLabel = (i: number): string => (i === 0 ? "default" : `state${i}`);

export const menuTitleKey = (menuId: string): I18nKey => `menus.${menuId}.title` as I18nKey;

export const elementTitleKey = (menuId: string, elementId: string, appIdx: number): I18nKey =>
  `menus.${menuId}.elements.${elementId}.${stateLabel(appIdx)}.title` as I18nKey;

export const elementLoreKey = (menuId: string, elementId: string, appIdx: number): I18nKey =>
  `menus.${menuId}.elements.${elementId}.${stateLabel(appIdx)}.lore` as I18nKey;

export const clickHandlerKeyPrefix = (
  menuId: string,
  elementId: string,
  appIdx: number,
  clickType: string,
): string => `menus.${menuId}.elements.${elementId}.${stateLabel(appIdx)}.click.${clickType}`;

export const commandKeyPrefix = (commandId: string): string => `commands.${commandId}`;

export const messageKeyAt = (prefix: string, idx: number): I18nKey =>
  (idx === 0 ? `${prefix}.message` : `${prefix}.message_${idx}`) as I18nKey;

export const showTitleKeyAt = (prefix: string, idx: number): I18nKey =>
  (idx === 0 ? `${prefix}.show_title` : `${prefix}.show_title_${idx}`) as I18nKey;

export const showSubtitleKeyAt = (prefix: string, idx: number): I18nKey =>
  (idx === 0 ? `${prefix}.show_subtitle` : `${prefix}.show_subtitle_${idx}`) as I18nKey;

export const dialogTitleKey = (dialogId: string): I18nKey => `dialogs.${dialogId}.title` as I18nKey;

export const dialogBodyTextKey = (dialogId: string, index: number): I18nKey =>
  `dialogs.${dialogId}.body.${index}.text` as I18nKey;

export const dialogInputLabelKey = (dialogId: string, inputId: string): I18nKey =>
  `dialogs.${dialogId}.inputs.${inputId}.label` as I18nKey;

export const dialogOptionLabelKey = (
  dialogId: string,
  inputId: string,
  optionValue: string,
): I18nKey => `dialogs.${dialogId}.inputs.${inputId}.options.${optionValue}.label` as I18nKey;

export const dialogButtonLabelKey = (dialogId: string, buttonId: string): I18nKey =>
  `dialogs.${dialogId}.buttons.${buttonId}.label` as I18nKey;

export const dialogButtonKeyPrefix = (dialogId: string, buttonId: string): string =>
  `dialogs.${dialogId}.buttons.${buttonId}`;

/**
 * Migrate an LText to `newKey`: move its value entry in `project.i18nKeys` and
 * repoint `lt.key`, in place (immer-safe). No-op when already correct. The
 * write primitive that `rekey*` in `@/domain/i18nSites` folds over.
 */
export function moveLTextKey(project: Project, lt: { key: I18nKey }, newKey: I18nKey): void {
  if (lt.key === newKey) return;
  const value = project.i18nKeys[lt.key];
  if (value) project.i18nKeys[newKey] = value;
  delete project.i18nKeys[lt.key];
  lt.key = newKey;
}
