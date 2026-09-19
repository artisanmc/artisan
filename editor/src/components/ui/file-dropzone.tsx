import { cn } from "@/lib/cx";
import { FileImage, UploadCloud, X } from "lucide-react";
import * as React from "react";

export interface FileDropzoneProps {
  file: File | null;
  onFile: (file: File | null) => void;
  accept?: string;
  /** Accessible name of the underlying file input. */
  label: string;
  /** Prompt shown while no file is picked. */
  prompt: React.ReactNode;
  /** Secondary line under the prompt (accepted formats, size…). */
  hint?: React.ReactNode;
  /** Label of the clear button shown once a file is picked. */
  clearLabel?: string;
  className?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Click-or-drop file area with a preview of the picked image. */
function FileDropzone({
  file,
  onFile,
  accept,
  label,
  prompt,
  hint,
  clearLabel,
  className,
}: FileDropzoneProps) {
  const [dragging, setDragging] = React.useState(false);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!file || !file.type.startsWith("image/") || typeof URL.createObjectURL !== "function") {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) onFile(dropped);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn(
        "relative flex min-h-[132px] items-center justify-center rounded-[var(--r-md)] border-2 border-dashed p-4 transition-colors",
        "focus-within:border-[var(--brand)]",
        dragging || file
          ? "border-[var(--brand-line)] bg-[var(--brand-soft)]"
          : "border-[var(--border-strong)] bg-[var(--surface-inset)] hover:border-[var(--brand-line)]",
        className,
      )}
    >
      <input
        type="file"
        aria-label={label}
        accept={accept}
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
      />
      {file ? (
        <div className="pointer-events-none flex w-full items-center gap-3">
          <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-[var(--r-sm)] border border-[var(--border-soft)] bg-[var(--surface)]">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt=""
                className="size-full object-contain [image-rendering:pixelated]"
              />
            ) : (
              <FileImage className="size-6 text-[var(--text-faint)]" aria-hidden />
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13px] text-[var(--text)]">{file.name}</span>
            <span className="text-[11.5px] text-[var(--text-mut)]">{formatSize(file.size)}</span>
          </div>
          <button
            type="button"
            aria-label={clearLabel}
            onClick={(e) => {
              e.stopPropagation();
              onFile(null);
            }}
            className="pointer-events-auto relative z-10 rounded-[var(--r-sm)] p-1.5 text-[var(--text-mut)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ) : (
        <div className="pointer-events-none flex flex-col items-center gap-1.5 text-center">
          <UploadCloud className="size-7 text-[var(--text-faint)]" aria-hidden />
          <span className="text-[13px] text-[var(--text)]">{prompt}</span>
          {hint != null && <span className="text-[11.5px] text-[var(--text-faint)]">{hint}</span>}
        </div>
      )}
    </div>
  );
}

export { FileDropzone };
