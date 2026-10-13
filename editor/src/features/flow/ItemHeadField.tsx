import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserRound } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type HeadSource,
  VIEWER_HEAD,
  buildHeadValue,
  headSourceOf,
  headValueOf,
} from "./headField";

export function HeadField({ head, onChange }: { head: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  // Hold the user's chosen source locally so an empty head doesn't snap the
  // select back to "none" mid-edit (which would unmount the value input and
  // make the field unusable from a blank state). Seed from the head at mount
  // (the use site remounts via a key per element/state, so this never leaks
  // across cards). Derive from the stored value only when it's non-empty — that
  // also keeps paste-auto-detection working.
  const [localSource, setLocalSource] = useState<HeadSource>(() => headSourceOf(head));
  const source = head ? headSourceOf(head) : localSource;
  const placeholder =
    source === "hdb"
      ? t("flow.headPlaceholderHdb")
      : source === "playerhead"
        ? t("flow.headPlaceholderPlayer")
        : t("flow.headPlaceholderBase64");
  return (
    <div>
      <span className="field-label">{t("flow.headLabel")}</span>
      <div className="flex items-center gap-1.5">
        <select
          className="h-8 w-32 shrink-0 rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] px-1.5 text-xs text-[var(--text)]"
          value={source}
          onChange={(e) => {
            const next = e.target.value as HeadSource;
            setLocalSource(next);
            if (next === "none") onChange("");
            // The player opening the menu is the common case: choosing the source is
            // enough, without typing a name.
            else if (next === "playerhead" && !headValueOf(head).trim()) onChange(VIEWER_HEAD);
            else {
              const rebuilt = buildHeadValue(next, headValueOf(head));
              if (rebuilt !== head) onChange(rebuilt);
            }
          }}
        >
          <option value="none">{t("flow.headSourceNone")}</option>
          <option value="hdb">{t("flow.headSourceHdb")}</option>
          <option value="basehead">{t("flow.headSourceBase64")}</option>
          <option value="playerhead">{t("flow.headSourcePlayer")}</option>
        </select>
        {source !== "none" ? (
          <Input
            value={headValueOf(head)}
            placeholder={placeholder}
            onChange={(e) => onChange(buildHeadValue(source, e.target.value))}
            className="h-8 flex-1 px-2 py-0 font-mono text-xs"
          />
        ) : null}
      </div>
      {source === "hdb" ? (
        <p className="mt-1 text-[10px] text-[var(--text-faint)]">{t("flow.headHdbHint")}</p>
      ) : null}
      {source === "playerhead" ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-1 h-6 gap-1 px-1 text-xs"
          title={t("flow.headViewerHint")}
          onClick={() => onChange(VIEWER_HEAD)}
        >
          <UserRound size={12} />
          {t("flow.headViewer")}
        </Button>
      ) : null}
    </div>
  );
}
