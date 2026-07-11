/** Vanilla + custom item catalog shapes shared by the item-bundle endpoints. */
export interface LibraryItem {
  id: string;
  label: string;
  category: string;
  texture?: string;
  model?: string;
  tints?: Record<number, string>;
}

export interface LibraryData {
  version: string;
  items: LibraryItem[];
}

export interface CustomItemsData {
  serverKeyId: string;
  items: LibraryItem[];
}
