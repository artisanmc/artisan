import type {
  AccountId,
  AssetId,
  CommandId,
  DialogId,
  ElementId,
  ItemTemplateId,
  LayerId,
  MenuId,
  ProjectId,
  TemplateId,
} from "./types";

let counter = 0;
const next = () => ++counter;

export const accountId = (s: string): AccountId => s as AccountId;
export const projectId = (s: string): ProjectId => s as ProjectId;
export const menuId = (s: string): MenuId => s as MenuId;
export const commandId = (s: string): CommandId => s as CommandId;
export const templateId = (s: string): TemplateId => s as TemplateId;
export const itemTemplateId = (s: string): ItemTemplateId => s as ItemTemplateId;
export const assetId = (s: string): AssetId => s as AssetId;
export const elementId = (s: string): ElementId => s as ElementId;
export const layerId = (s: string): LayerId => s as LayerId;

export const newProjectId = () => projectId(`p_${next()}_${Date.now().toString(36)}`);
export const newMenuId = () => menuId(`m_${next()}_${Date.now().toString(36)}`);
export const newElementId = () => elementId(`el_${next()}_${Date.now().toString(36)}`);
export const newLayerId = () => layerId(`l_${next()}_${Date.now().toString(36)}`);
export const newCommandId = () => commandId(`c_${next()}_${Date.now().toString(36)}`);
export const newAssetId = () => assetId(`a_${next()}_${Date.now().toString(36)}`);
export const dialogId = (s: string): DialogId => s as DialogId;
export const newDialogId = () => dialogId(`d_${next()}_${Date.now().toString(36)}`);
export const newItemTemplateId = () =>
  itemTemplateId(`itpl_${next()}_${Date.now().toString(36)}`);
