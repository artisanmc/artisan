import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import {
  type AttachmentRefusal,
  type PendingAttachment,
  attachmentFromBytes,
} from "@/lib/aiAttachments";
import { apiRequest } from "@/lib/api/client";
import { listServerProjects, readProjectFiles } from "@/lib/api/projectFiles";
import { cn } from "@/lib/cx";
import { ChevronLeft, FileText, Folder, Image } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

interface ModuleFiles {
  texts: Record<string, string>;
  binaries: string[];
}

const IMAGE = /\.(png|jpe?g|gif|webp)$/i;

/**
 * Picks files of the server's modules to send to the assistant: a module, then its files, read
 * as the player can read them (their session, their permissions). Each pick is added at once.
 */
export function ServerFilePicker({
  serverId,
  open,
  onOpenChange,
  onPick,
}: {
  serverId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Returns why the file was not added, or null. */
  onPick: (attachment: PendingAttachment) => AttachmentRefusal | null;
}) {
  const { t } = useTranslation();
  const [modules, setModules] = useState<string[] | null>(null);
  const [module, setModule] = useState<string | null>(null);
  const [files, setFiles] = useState<ModuleFiles | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setModule(null);
    setFiles(null);
    setFailure(null);
    setPicked(new Set());
    setModules(null);
    void listServerProjects(serverId).then((result) => {
      if (cancelled) return;
      if (result.ok) setModules([...result.projectIds].sort());
      else setFailure(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [open, serverId]);

  useEffect(() => {
    if (!module) return;
    let cancelled = false;
    setFiles(null);
    setFilter("");
    void readProjectFiles({ serverId, diskId: module }).then((result) => {
      if (cancelled) return;
      if (!result.ok) return setFailure(result.error);
      if (result.unchanged) return;
      setFiles({ texts: result.files, binaries: (result.binaries ?? []).map((b) => b.path) });
    });
    return () => {
      cancelled = true;
    };
  }, [module, serverId]);

  const paths = useMemo(() => {
    if (!files) return [];
    const all = [...Object.keys(files.texts), ...files.binaries.filter((p) => IMAGE.test(p))];
    const query = filter.trim().toLowerCase();
    return all.filter((p) => !query || p.toLowerCase().includes(query)).sort();
  }, [files, filter]);

  const pick = async (path: string) => {
    if (!module || !files || picked.has(path)) return;
    setFailure(null);
    setLoading(path);
    try {
      let bytes: Uint8Array;
      if (path in files.texts) bytes = new TextEncoder().encode(files.texts[path]);
      else {
        const response = await apiRequest(
          `/api/v1/servers/${serverId}/projects/${encodeURIComponent(module)}/asset?path=${encodeURIComponent(path)}`,
        );
        if (!response.ok) return setFailure("read_error");
        bytes = new Uint8Array(await response.arrayBuffer());
      }
      const name = `${module}/${path}`;
      const attachment = attachmentFromBytes(name, bytes, {
        project: `${serverId}.${module}`,
        path,
      });
      const refusal = typeof attachment === "string" ? attachment : onPick(attachment);
      if (refusal) return setFailure(refusal);
      setPicked((s) => new Set(s).add(path));
    } catch {
      setFailure("network_error");
    } finally {
      setLoading(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("ai.attach.serverTitle")}</DialogTitle>
          <DialogDescription>
            {module ? t("ai.attach.serverFiles", { module }) : t("ai.attach.serverHelp")}
          </DialogDescription>
        </DialogHeader>
        {module && (
          <div className="flex items-center gap-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setModule(null)}>
              <ChevronLeft className="size-3.5" />
              {t("ai.attach.modules")}
            </button>
            <input
              className="input h-8 flex-1"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t("ai.attach.filter")}
              aria-label={t("ai.attach.filter")}
            />
          </div>
        )}
        <div
          className="flex max-h-[50vh] min-h-[160px] flex-col gap-0.5 overflow-y-auto"
          data-testid="server-file-list"
        >
          {!module &&
            (modules === null ? (
              !failure && <Spinner className="m-auto size-4" />
            ) : modules.length === 0 ? (
              <p className="text-[13px] text-[var(--text-mut)]">{t("ai.attach.noModules")}</p>
            ) : (
              modules.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="btn btn-ghost btn-sm justify-start"
                  onClick={() => setModule(id)}
                >
                  <Folder className="size-3.5 shrink-0" />
                  <span className="truncate">{id}</span>
                </button>
              ))
            ))}
          {module &&
            (files === null ? (
              !failure && <Spinner className="m-auto size-4" />
            ) : paths.length === 0 ? (
              <p className="text-[13px] text-[var(--text-mut)]">{t("ai.attach.noFiles")}</p>
            ) : (
              paths.map((path) => (
                <button
                  key={path}
                  type="button"
                  className={cn(
                    "btn btn-ghost btn-sm justify-start font-mono text-[12px]",
                    picked.has(path) && "text-[var(--brand)]",
                  )}
                  aria-pressed={picked.has(path)}
                  disabled={loading !== null}
                  onClick={() => void pick(path)}
                >
                  {IMAGE.test(path) ? (
                    <Image className="size-3.5 shrink-0" />
                  ) : (
                    <FileText className="size-3.5 shrink-0" />
                  )}
                  <span className="truncate">{path}</span>
                  {loading === path && <Spinner className="ml-auto size-3" />}
                  {picked.has(path) && (
                    <span className="ml-auto shrink-0 text-[11px]">{t("ai.attach.added")}</span>
                  )}
                </button>
              ))
            ))}
        </div>
        {failure && (
          <p role="alert" className="text-[13px] text-[var(--danger)]">
            {t(`ai.errors.${failure}`, { defaultValue: t("ai.attach.readFailed") })}
          </p>
        )}
        <DialogFooter>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => onOpenChange(false)}
          >
            {t("ai.attach.done")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
