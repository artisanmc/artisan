import type {
  AccountId,
  AssetId,
  CapturedItemId,
  CommandId,
  DataModelId,
  DataSourceId,
  DialogId,
  ElementId,
  LayerId,
  MenuId,
  ProjectId,
} from "./types";

let counter = 0;
const next = () => ++counter;

export const accountId = (s: string): AccountId => s as AccountId;
export const projectId = (s: string): ProjectId => s as ProjectId;
export const menuId = (s: string): MenuId => s as MenuId;
export const commandId = (s: string): CommandId => s as CommandId;
export const capturedItemId = (s: string): CapturedItemId => s as CapturedItemId;
export const assetId = (s: string): AssetId => s as AssetId;
export const elementId = (s: string): ElementId => s as ElementId;
export const layerId = (s: string): LayerId => s as LayerId;

export const newProjectId = () => projectId(`p_${next()}_${Date.now().toString(36)}`);
export const newMenuId = () => menuId(`m_${next()}_${Date.now().toString(36)}`);
export const newElementId = () => elementId(`el_${next()}_${Date.now().toString(36)}`);
export const newLayerId = () => layerId(`l_${next()}_${Date.now().toString(36)}`);
export const newCommandId = () => commandId(`c_${next()}_${Date.now().toString(36)}`);
export const dialogId = (s: string): DialogId => s as DialogId;
export const newCapturedItemId = () =>
  capturedItemId(`ci_${next()}_${Date.now().toString(36)}`);
export const dataSourceId = (s: string): DataSourceId => s as DataSourceId;
export const dataModelId = (s: string): DataModelId => s as DataModelId;
export const newDataModelId = () => dataModelId(`dm_${next()}_${Date.now().toString(36)}`);
