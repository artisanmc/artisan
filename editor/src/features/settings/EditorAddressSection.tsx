import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api/client";
import {
  type EditorAddress,
  type TakenAddress,
  checkAddressName,
  getEditorAddress,
  takeAddressName,
  validAddressName,
} from "@/lib/api/editorAddress";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type Availability = "idle" | "checking" | "free" | string;

const errorCode = (e: unknown) => (e instanceof ApiError ? e.code : "offline");

/**
 * Names the editor's address on the tunnel server (ADR `editor-tunnel`):
 * `survie.artisanmc.app` next to the `<id>` one, which keeps working. The
 * session cookie belongs to the old address: the hub hands back a sign-in link
 * for the new one.
 */
export function EditorAddressSection() {
  const { t } = useTranslation();
  const [address, setAddress] = useState<EditorAddress | null | undefined>(undefined);
  const [name, setName] = useState("");
  const [availability, setAvailability] = useState<Availability>("idle");
  const [busy, setBusy] = useState(false);
  const [taken, setTaken] = useState<TakenAddress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getEditorAddress()
      .then(setAddress)
      .catch(() => setAddress(null));
  }, []);

  useEffect(() => {
    if (!name || name === address?.name) return setAvailability("idle");
    if (!validAddressName(name)) return setAvailability("invalid");
    setAvailability("checking");
    let cancelled = false;
    const timer = setTimeout(() => {
      checkAddressName(name)
        .then(() => !cancelled && setAvailability("free"))
        .catch((e) => !cancelled && setAvailability(errorCode(e)));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [name, address?.name]);

  if (address === undefined)
    return <p className="text-[13px] text-[var(--text-mut)]">{t("editorAddress.loading")}</p>;
  if (address === null || !address.tunnel || !address.names)
    return <p className="text-[13px] text-[var(--text-mut)]">{t("editorAddress.unavailable")}</p>;

  const submit = async (next: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await takeAddressName(next);
      setTaken(result);
      setAddress({ ...address, name: result.name, url: result.url });
      setName("");
    } catch (e) {
      setError(
        t(`editorAddress.errors.${errorCode(e)}`, {
          defaultValue: t("editorAddress.errors.offline"),
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <span className="field-label">{t("editorAddress.current")}</span>
        {address.url ? (
          <a className="text-[14px] text-[var(--brand)] break-all" href={address.url}>
            {address.url}
          </a>
        ) : (
          <span className="text-[13px] text-[var(--text-mut)]">
            {t("editorAddress.disconnected")}
          </span>
        )}
      </div>

      {taken && (
        <div className="card flex flex-col gap-3 p-4">
          <p className="text-[13px] text-[var(--text)]">
            {taken.name
              ? t("editorAddress.takenHelp", { url: taken.url })
              : t("editorAddress.releasedHelp", { url: taken.url })}
          </p>
          {taken.login && (
            <a className="btn-primary btn-sm self-start" href={taken.login}>
              {t("editorAddress.open")}
            </a>
          )}
        </div>
      )}

      <div className="rule" />

      <FormField label={t("editorAddress.name")} hint={t("editorAddress.nameHint")}>
        <div className="flex items-center gap-2">
          <Input
            value={name}
            placeholder={address.name ?? "survie"}
            maxLength={32}
            onChange={(e) => setName(e.target.value.trim().toLowerCase())}
          />
          <span className="shrink-0 text-[13px] text-[var(--text-mut)]">{address.suffix}</span>
        </div>
      </FormField>
      {availability !== "idle" && (
        <p
          className={
            availability === "free"
              ? "text-[12px] text-[var(--success)]"
              : availability === "checking"
                ? "text-[12px] text-[var(--text-mut)]"
                : "text-[12px] text-[var(--danger)]"
          }
        >
          {availability === "free"
            ? t("editorAddress.free")
            : availability === "checking"
              ? t("editorAddress.checking")
              : t(`editorAddress.errors.${availability}`, {
                  defaultValue: t("editorAddress.errors.offline"),
                })}
        </p>
      )}
      <div className="flex items-center justify-end gap-3">
        {error && <p className="text-[12px] text-[var(--danger)]">{error}</p>}
        {address.name && (
          <button
            type="button"
            className="btn-ghost btn-sm"
            disabled={busy}
            onClick={() =>
              window.confirm(t("editorAddress.releaseConfirm", { name: address.name })) &&
              submit("")
            }
          >
            {t("editorAddress.release", { name: address.name })}
          </button>
        )}
        <button
          type="button"
          className="btn-primary btn-sm"
          disabled={busy || availability !== "free"}
          onClick={() => submit(name)}
        >
          {t("editorAddress.take")}
        </button>
      </div>
    </section>
  );
}
