import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { useImageReach } from "./kitAssets";

/**
 * What an image name written in a menu of `projectId` reaches, said where it is written (ADR
 * `common-images-and-themes`, decision 3): nothing when it is the module's own image or a
 * common one; an alert when no image answers it; whose it is when it is another module's,
 * with what to write (`onRename`) when the name alone found it.
 */
export function ImageReachNote({
  projectId,
  name,
  onRename,
}: {
  projectId: string;
  name: string | undefined;
  onRename?: (ref: string) => void;
}) {
  const { t } = useTranslation();
  const reach = useImageReach(projectId)(name ?? "");
  if (!name || !reach) return null;
  if (reach.kind === "none")
    return (
      <p role="alert" className="text-xs text-[var(--danger)]">
        {t("imageReach.none", { name })}
      </p>
    );
  if (reach.kind !== "module") return null;
  const ref = `${reach.folder}:${reach.name}`;
  if (name === ref)
    return (
      <p className="text-xs text-[var(--text-mut)]">
        {t("imageReach.module", { module: reach.folder })}
      </p>
    );
  return (
    <div className="flex flex-col items-start gap-1">
      <p className="text-xs text-[var(--text-mut)]">
        {t("imageReach.elsewhere", { name, module: reach.folder })}
      </p>
      {onRename && (
        <Button size="sm" variant="outline" onClick={() => onRename(ref)}>
          {t("imageReach.write", { ref })}
        </Button>
      )}
    </div>
  );
}
