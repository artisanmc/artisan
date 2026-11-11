/** A server as the sidebar lists it. */
export interface ServerEntry {
  serverId: string;
  /** URL slug — the serverId URL param may carry it instead of the id. */
  serverSlug?: string;
  serverLabel: string;
  /** Absent = unknown state: nothing is shown rather than an assumed offline. */
  online?: boolean;
  /** Plugin too different from the hub: listed, but not editable. */
  updateRequired?: boolean;
}
