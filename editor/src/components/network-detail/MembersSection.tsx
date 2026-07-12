import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  type Invite,
  type Member,
  type MemberRole,
  createInvite,
  listInvites,
  listMembers,
  removeMember,
  revokeInvite,
  updateMemberRole,
} from "@/lib/api/members";
import { useAuthStore } from "@/state/authStore";
import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

const MANAGER_ROLES: MemberRole[] = ["owner", "admin"];
const isManager = (role: MemberRole) => MANAGER_ROLES.includes(role);

interface Props {
  networkId: string;
}

export function MembersSection({ networkId }: Props) {
  const { t } = useTranslation();
  const currentUser = useAuthStore((s) => s.currentUser);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [busyInviteId, setBusyInviteId] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listMembers(networkId)
      .then((list) => {
        if (!cancelled) setMembers(list);
      })
      .catch(() => {
        if (!cancelled) setMembers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [networkId]);

  const currentRole = members?.find((m) => m.userId === currentUser?.id)?.role ?? null;
  const canManage = currentRole !== null && isManager(currentRole);
  const managerCount = members?.filter((m) => isManager(m.role)).length ?? 0;

  useEffect(() => {
    if (!canManage) {
      setInvites([]);
      return;
    }
    let cancelled = false;
    listInvites(networkId)
      .then((list) => {
        if (!cancelled) setInvites(list);
      })
      .catch(() => {
        if (!cancelled) setInvites([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [networkId, canManage]);

  async function handleToggleRole(member: Member) {
    const nextRole: MemberRole = isManager(member.role) ? "member" : "owner";
    setBusyUserId(member.userId);
    try {
      await updateMemberRole(networkId, member.userId, nextRole);
      setMembers((prev) =>
        prev ? prev.map((m) => (m.userId === member.userId ? { ...m, role: nextRole } : m)) : prev,
      );
    } catch (err) {
      toast.error(
        (err as Error & { status?: number }).status === 409
          ? t("membersSection.errors.lastOwner")
          : t("membersSection.errors.generic"),
      );
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleRemove(member: Member) {
    if (!window.confirm(t("membersSection.confirmRemove", { name: member.displayName || member.email }))) return;
    setBusyUserId(member.userId);
    try {
      await removeMember(networkId, member.userId);
      setMembers((prev) => (prev ? prev.filter((m) => m.userId !== member.userId) : prev));
    } catch (err) {
      toast.error(
        (err as Error & { status?: number }).status === 409
          ? t("membersSection.errors.lastOwner")
          : t("membersSection.errors.generic"),
      );
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleRevoke(invite: Invite) {
    setBusyInviteId(invite.id);
    try {
      await revokeInvite(networkId, invite.id);
      setInvites((prev) => (prev ? prev.filter((i) => i.id !== invite.id) : prev));
    } catch {
      toast.error(t("membersSection.errors.generic"));
    } finally {
      setBusyInviteId(null);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <h2 className="eyebrow">{t("networkDetail.members")}</h2>
        <span className="h-px flex-1 bg-[var(--border-soft)]" />
        {canManage && (
          <button className="btn btn-xs btn-ghost" onClick={() => setInviteOpen(true)}>
            + {t("membersSection.invite")}
          </button>
        )}
      </div>

      {members === null ? (
        <p className="text-[12px] text-[var(--text-faint)]">{t("networkDetail.loading")}</p>
      ) : (
        <ul className="card flex flex-col divide-y divide-[var(--border-soft)] p-0">
          {members.map((m) => {
            const manager = isManager(m.role);
            const isLastManager = manager && managerCount <= 1;
            const busy = busyUserId === m.userId;
            return (
              <li key={m.userId} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-[13.5px] text-[var(--text)]">
                    {m.displayName || m.email}
                  </span>
                  <span className="truncate text-[11.5px] text-[var(--text-faint)]">{m.email}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={manager ? "terra" : "sage"}>
                    {t(`membersSection.role.${m.role}`, m.role)}
                  </Badge>
                  <span className="text-[11px] text-[var(--text-faint)]">
                    {new Date(m.createdAt).toLocaleDateString()}
                  </span>
                  {canManage && (
                    <>
                      <button
                        className="btn btn-xs btn-ghost"
                        disabled={busy || isLastManager}
                        title={isLastManager ? t("membersSection.lastOwnerTooltip") : undefined}
                        onClick={() => handleToggleRole(m)}
                      >
                        {manager
                          ? t("membersSection.demote")
                          : t("membersSection.promote")}
                      </button>
                      <button
                        className="btn btn-xs btn-ghost"
                        disabled={busy || isLastManager}
                        title={isLastManager ? t("membersSection.lastOwnerTooltip") : undefined}
                        onClick={() => handleRemove(m)}
                      >
                        {t("membersSection.remove")}
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {canManage && invites !== null && invites.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="field-label">{t("membersSection.pendingInvites")}</span>
          <ul className="card flex flex-col divide-y divide-[var(--border-soft)] p-0">
            {invites.map((invite) => (
              <li key={invite.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="mono truncate text-[12.5px] text-[var(--text)]">{invite.code}</span>
                  {invite.email && (
                    <span className="truncate text-[11.5px] text-[var(--text-faint)]">{invite.email}</span>
                  )}
                  <span className="text-[11px] text-[var(--text-faint)]">
                    {t("membersSection.usedCount", {
                      used: invite.usedCount,
                      max: invite.maxUses ?? "∞",
                    })}
                    {" · "}
                    {t("membersSection.expiresAt", {
                      date: new Date(invite.expiresAt).toLocaleDateString(),
                    })}
                  </span>
                </div>
                <button
                  className="btn btn-xs btn-ghost shrink-0"
                  disabled={busyInviteId === invite.id}
                  onClick={() => handleRevoke(invite)}
                >
                  {t("membersSection.revoke")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        networkId={networkId}
        onCreated={(invite) => setInvites((prev) => [...(prev ?? []), invite])}
      />
    </section>
  );
}

function InviteDialog({
  open,
  onOpenChange,
  networkId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  networkId: string;
  onCreated: (invite: Invite) => void;
}) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<Invite | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) {
      setEmail("");
      setSubmitting(false);
      setCreated(null);
      setCopied(false);
    }
  }, [open]);

  async function submit() {
    setSubmitting(true);
    try {
      const invite = await createInvite(networkId, email.trim() || undefined);
      setCreated(invite);
      onCreated(invite);
    } catch {
      toast.error(t("membersSection.errors.generic"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopy() {
    if (!created) return;
    await navigator.clipboard.writeText(created.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("membersSection.inviteDialog.title")}</DialogTitle>
        </DialogHeader>

        {created ? (
          <div className="flex flex-col gap-2">
            <span className="field-label">{t("membersSection.inviteDialog.linkLabel")}</span>
            <div className="relative">
              <code className="mono block break-all rounded-[14px] border border-[var(--border)] bg-[var(--surface-inset)] px-3 py-3 pr-12 text-[12.5px] text-[var(--text-mut)]">
                {created.url}
              </code>
              <button
                type="button"
                onClick={handleCopy}
                className="absolute right-1.5 top-1.5 btn btn-icon btn-sm btn-ghost"
                aria-label={t("networkDetail.copy")}
              >
                {copied ? (
                  <Check className="size-[14px] text-[var(--success)]" />
                ) : (
                  <Copy className="size-[14px]" />
                )}
              </button>
            </div>
            {created.email && (
              <p className="text-[12px] text-[var(--text-faint)]">
                {t("membersSection.inviteDialog.emailSent", { email: created.email })}
              </p>
            )}
            <div className="mt-2 flex justify-end">
              <button className="btn btn-sm btn-primary" onClick={() => onOpenChange(false)}>
                {t("networkDetail.close")}
              </button>
            </div>
          </div>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-[12px]">
              <span className="text-[var(--text-mut)]">{t("membersSection.inviteDialog.emailField")}</span>
              <input
                className="input"
                type="email"
                placeholder={t("membersSection.inviteDialog.emailPlaceholder")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
            </label>
            <div className="mt-3 flex justify-end gap-2">
              <button className="btn btn-sm btn-ghost" onClick={() => onOpenChange(false)}>
                {t("membersSection.inviteDialog.cancel")}
              </button>
              <button className="btn btn-sm btn-primary" onClick={submit} disabled={submitting}>
                {submitting
                  ? t("membersSection.inviteDialog.submitting")
                  : t("membersSection.inviteDialog.submit")}
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
