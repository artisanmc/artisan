import { Spinner } from "@/components/ui/spinner";
import { readDraftBlob } from "@/lib/api/projectDrafts";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/** One object URL per image content, kept for the session: a hash names the same bytes for ever. */
const urls = new Map<string, Promise<string>>();

function urlOf(project: string, draftId: string, hash: string): Promise<string> {
  let url = urls.get(hash);
  if (!url) {
    url = readDraftBlob(project, draftId, hash).then((bytes) =>
      URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/png" })),
    );
    // A failed read is asked again by the next card.
    url.catch(() => urls.delete(hash));
    urls.set(hash, url);
  }
  return url;
}

/** Forgets the images read so far (tests). */
export function resetDraftImages() {
  urls.clear();
}

type Read = { status: "loading" } | { status: "ready"; url: string } | { status: "failed" };

/**
 * An image a draft holds, by its content hash: pixel art shown at a whole number of times its
 * size, as large as [maxWidth] by [maxHeight] allow, over a checkerboard where it is transparent.
 */
export function DraftImage({
  project,
  draftId,
  hash,
  label,
  maxWidth = 320,
  maxHeight = 240,
}: {
  /** The Project's id, `<server id>.<folder>`. */
  project: string;
  draftId: string;
  hash: string;
  /** What the image is, for a reader who cannot see it: its path. */
  label: string;
  maxWidth?: number;
  maxHeight?: number;
}) {
  const { t } = useTranslation();
  const [read, setRead] = useState<Read>({ status: "loading" });
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setRead({ status: "loading" });
    setSize(null);
    void urlOf(project, draftId, hash).then(
      (url) => !cancelled && setRead({ status: "ready", url }),
      () => !cancelled && setRead({ status: "failed" }),
    );
    return () => {
      cancelled = true;
    };
  }, [project, draftId, hash]);

  if (read.status === "loading")
    return (
      <p className="flex items-center gap-2 text-[12.5px] text-[var(--text-mut)]">
        <Spinner className="size-3.5" />
        {t("ai.page.readingImage")}
      </p>
    );
  if (read.status === "failed")
    return (
      <p role="alert" className="text-[12.5px] text-[var(--danger)]">
        {t("ai.page.imageUnreadable")}
      </p>
    );
  // Whole pixels only: 16x16 shows eight times its size, a window at its own.
  const scale = size
    ? Math.max(1, Math.min(8, Math.floor(Math.min(maxWidth / size.width, maxHeight / size.height))))
    : 1;
  return (
    <figure className="flex flex-col items-start gap-1" data-testid="assistant-image">
      <div className="checker max-w-full overflow-auto rounded-[var(--r-md)] border border-[var(--border-soft)] p-2">
        <img
          src={read.url}
          alt={label}
          onLoad={(e) =>
            setSize({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })
          }
          width={size ? size.width * scale : undefined}
          height={size ? size.height * scale : undefined}
          className="block max-w-none [image-rendering:pixelated]"
          // Measured first, shown once its size is known: no jump from one size to the other.
          style={size ? undefined : { visibility: "hidden", position: "absolute" }}
        />
      </div>
      {size && (
        <figcaption className="font-mono text-[11.5px] text-[var(--text-faint)]">
          {size.width} × {size.height}
        </figcaption>
      )}
    </figure>
  );
}
