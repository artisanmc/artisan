import type { ReactNode } from "react";
import { ImportThemeDialog } from "./ImportThemeDialog";

/** What the Resources' places offer to bring a theme from its archive onto the server. */
export const themeImporter = (props: {
  serverKeyId: string;
  taken: readonly string[];
  onImported: (name: string) => void;
}): ReactNode => <ImportThemeDialog {...props} />;
