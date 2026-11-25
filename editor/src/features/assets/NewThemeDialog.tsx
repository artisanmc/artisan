import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createProject } from "@/lib/api/servers";
import { KIT_FOLDER } from "@/lib/pack/kit";
import { isThemeName } from "@/lib/pack/theme";
import { useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Creates a theme on the server: an empty folder of its own beside the common images
 * (`createProject` with the role `theme`). It changes nothing until it holds colours or
 * drawings and is put in place.
 */
export function NewThemeDialog({
  serverKeyId,
  taken = [],
  onCreated,
}: {
  serverKeyId: string;
  /** The server's themes: a name among them is refused before the request. */
  taken?: readonly string[];
  onCreated: (name: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();
  const problem = !trimmed
    ? null
    : !isThemeName(trimmed) || trimmed === KIT_FOLDER
      ? "invalid_name"
      : taken.includes(trimmed)
        ? "project_exists"
        : null;
  const shown = error ?? problem;

  const submit = async () => {
    if (submitting || !trimmed || problem) return;
    setSubmitting(true);
    setError(null);
    try {
      await createProject(serverKeyId, trimmed, "theme");
      setName("");
      setOpen(false);
      onCreated(trimmed);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "create_failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          + {t("kit.newTheme.open")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("kit.newTheme.title")}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <p className="text-[13px] text-[var(--text-mut)]">{t("kit.newTheme.intro")}</p>
          <Input
            aria-label={t("kit.newTheme.name")}
            placeholder={t("kit.newTheme.placeholder")}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
          />
          {shown ? (
            <div role="alert" className="text-xs text-[var(--danger)]">
              {t(`kit.newTheme.errors.${shown}`, {
                defaultValue: t("kit.newTheme.errors.create_failed"),
              })}
            </div>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              {t("newProjectDialog.cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={!trimmed || !!problem || submitting}>
              {submitting ? "…" : t("newProjectDialog.create")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
