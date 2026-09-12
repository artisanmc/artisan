import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { deleteAccount, requestAccountDeletion } from "@/lib/api/auth";
import { clearDeletedAccountSession } from "@/state/authStore";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AuthCard } from "./AuthCard";

function DeletionError({ error }: { error: string }) {
  const { t } = useTranslation();
  return (
    <p role="alert" className="text-sm text-[var(--danger)]">
      {t(`accountDeletion.errors.${error}`, { defaultValue: t("accountDeletion.errors.unknown") })}
    </p>
  );
}

export function DeleteAccountSection({ apiUrl, email }: { apiUrl: string; email: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  async function send() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await requestAccountDeletion({ apiUrl });
      if (result.ok) {
        setSent(true);
        setOpen(false);
      } else setError(result.error);
    } catch {
      setError("unknown");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card flex flex-col gap-3 p-5">
      <h2 className="eyebrow">{t("accountDeletion.title")}</h2>
      <p className="text-sm text-[var(--text-mut)]">{t("accountDeletion.body")}</p>
      {sent && (
        <output className="text-sm text-[var(--text)]">
          {t("accountDeletion.sent", { email })}
        </output>
      )}
      <button
        type="button"
        className="btn btn-danger self-start"
        onClick={() => {
          setError("");
          setOpen(true);
        }}
      >
        {t("accountDeletion.title")}
      </button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("accountDeletion.title")}</DialogTitle>
            <DialogDescription>{t("accountDeletion.body")}</DialogDescription>
          </DialogHeader>
          {error && <DeletionError error={error} />}
          <DialogFooter>
            <button
              type="button"
              className="btn btn-outline"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              {t("accountDeletion.cancel")}
            </button>
            <button type="button" className="btn btn-danger" disabled={busy} onClick={send}>
              {t(busy ? "accountDeletion.busy" : "accountDeletion.send")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export function DeleteAccountConfirmation({ apiUrl, token }: { apiUrl: string; token: string }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(token ? "" : "invalid_token");
  async function confirm() {
    if (busy || !token) return;
    setBusy(true);
    setError("");
    try {
      const result = await deleteAccount({ apiUrl }, { token });
      if (result.ok) {
        clearDeletedAccountSession();
        setDone(true);
      } else setError(result.error);
    } catch {
      setError("unknown");
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthCard title={t("accountDeletion.title")}>
      {done ? (
        <>
          <output>{t("accountDeletion.done")}</output>
          <p className="text-sm text-[var(--text-mut)]">{t("accountDeletion.doneBody")}</p>
          <a href="/login" className="btn btn-outline">
            {t("auth.backToLogin")}
          </a>
        </>
      ) : (
        <>
          <p className="text-sm text-[var(--text-mut)]">{t("accountDeletion.body")}</p>
          <p className="text-sm text-[var(--text)]">{t("accountDeletion.confirmBody")}</p>
          {error && <DeletionError error={error} />}
          {token && error !== "invalid_token" && (
            <button
              type="button"
              disabled={busy}
              onClick={confirm}
              className="btn btn-danger w-full"
            >
              {t(busy ? "accountDeletion.busy" : "accountDeletion.confirm")}
            </button>
          )}
          <a href="/account" className="btn btn-outline">
            {t("accountDeletion.back")}
          </a>
        </>
      )}
    </AuthCard>
  );
}
