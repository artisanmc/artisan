import { useEffect } from "react";

export const APP_TITLE = "Artisan";

/**
 * The browser tab's title: `Artisan | <server> - <project>`, each part dropped
 * when unknown, down to `Artisan` alone. Blank parts count as unknown.
 */
export function documentTitle(
  serverLabel: string | null | undefined,
  projectName: string | null | undefined,
): string {
  const context = [serverLabel, projectName]
    .map((part) => part?.trim())
    .filter((part): part is string => !!part)
    .join(" - ");
  return context ? `${APP_TITLE} | ${context}` : APP_TITLE;
}

/** Keeps `document.title` on the current server and project; back to `Artisan` on unmount. */
export function useDocumentTitle(
  serverLabel: string | null | undefined,
  projectName: string | null | undefined,
): void {
  useEffect(() => {
    document.title = documentTitle(serverLabel, projectName);
  }, [serverLabel, projectName]);
  useEffect(
    () => () => {
      document.title = APP_TITLE;
    },
    [],
  );
}
