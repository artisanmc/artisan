import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AskEmbed } from "./exportElsewhere";

/**
 * Asks whether a module's archive takes the images of other modules its menus name (ADR
 * `common-images-and-themes`, decision 10: embedded on request). Closing it gives the export up.
 */
export function EmbedImagesDialog({
  images,
  onAnswer,
}: {
  /** The images, as `<folder>:<name>`; `null` while nothing is asked. */
  images: string[] | null;
  onAnswer: (embed: boolean | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={images !== null} onOpenChange={(open) => (open ? undefined : onAnswer(null))}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("export.embed.title")}</DialogTitle>
          <DialogDescription>
            {t("export.embed.description", { count: images?.length ?? 0 })}
          </DialogDescription>
        </DialogHeader>
        <ul
          className="mono flex max-h-48 flex-col gap-0.5 overflow-y-auto text-[12.5px] text-[var(--text)]"
          data-testid="export-embed-images"
        >
          {(images ?? []).map((image) => (
            <li key={image} className="truncate">
              {image}
            </li>
          ))}
        </ul>
        <p className="text-[12px] text-[var(--text-mut)]">{t("export.embed.hint")}</p>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onAnswer(null)}>
            {t("newProjectDialog.cancel")}
          </Button>
          <Button variant="outline" onClick={() => onAnswer(false)}>
            {t("export.embed.without")}
          </Button>
          <Button variant="primary" onClick={() => onAnswer(true)}>
            {t("export.embed.with")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The question `runExportZip` asks, and the dialog that answers it. */
export function useEmbedAsk(): { ask: AskEmbed; dialog: React.ReactNode } {
  const [asked, setAsked] = useState<{
    images: string[];
    answer: (embed: boolean | null) => void;
  } | null>(null);
  const ask = useCallback<AskEmbed>(
    (images) =>
      new Promise((resolve) => {
        setAsked({
          images,
          answer: (embed) => {
            setAsked(null);
            resolve(embed);
          },
        });
      }),
    [],
  );
  return {
    ask,
    dialog: (
      <EmbedImagesDialog
        images={asked?.images ?? null}
        onAnswer={(embed) => asked?.answer(embed)}
      />
    ),
  };
}
