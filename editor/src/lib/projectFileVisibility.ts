/** Private working state never belongs in a shared project tree or archive. */
export function isPrivateProjectPath(path: string): boolean {
  const parts = path.replaceAll("\\", "/").toLowerCase().split("/");
  return parts.some(
    (part, index) =>
      part === ".artisan-sync.yaml" ||
      part.startsWith(".artisan-write-") ||
      (part === ".artisan" &&
        ["drafts", "transactions", "history", "rename-operation.json"].includes(
          parts[index + 1] ?? "",
        )),
  );
}
