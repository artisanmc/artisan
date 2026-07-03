import { Badge } from "@/components/ui/badge";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type AdminUserProfileDto, getAdminUser, updateAdminUser } from "@/lib/api/adminUsers";
import { useAuthStore } from "@/state/authStore";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { UserAiTab } from "./UserAiTab";

/**
 * Admin view of one user: editable identity fields (name, email, admin flag)
 * + read-only account facts (sign-in method, creation date, networks).
 * Only the fields that actually changed are PATCHed.
 */
export function UserProfile({ userId }: { userId: string }) {
  const { t, i18n } = useTranslation();
  const me = useAuthStore((s) => s.currentUser);
  const [profile, setProfile] = useState<AdminUserProfileDto | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAdminUser(userId).then((p) => {
      if (cancelled || !p) return;
      setProfile(p);
      setName(p.name);
      setEmail(p.email);
      setIsAdmin(p.isAdmin);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  async function save() {
    if (!profile || busy) return;
    const patch: { name?: string; email?: string; isAdmin?: boolean } = {};
    if (name !== profile.name) patch.name = name;
    if (email !== profile.email) patch.email = email;
    if (isAdmin !== profile.isAdmin) patch.isAdmin = isAdmin;
    if (Object.keys(patch).length === 0) return;
    setBusy(true);
    const r = await updateAdminUser(userId, patch);
    setBusy(false);
    if (r.ok) {
      setProfile({ ...profile, ...r.data });
      setName(r.data.name);
      setEmail(r.data.email);
      setIsAdmin(r.data.isAdmin);
      toast.success(t("admin.users.saved"));
    } else {
      toast.error(
        t(`admin.users.errors.${r.error ?? "generic"}`, {
          defaultValue: t("admin.users.errors.generic"),
        }),
      );
    }
  }

  if (!profile) {
    return (
      <div className="py-10 text-[13px] text-[var(--text-mut)]">{t("admin.users.loading")}</div>
    );
  }

  const isSelf = me?.id === profile.id;

  return (
    <Tabs defaultValue="profile" className="flex max-w-lg flex-col gap-6">
      <TabsList>
        <TabsTrigger value="profile">{t("admin.users.title")}</TabsTrigger>
        <TabsTrigger value="ai">{t("admin.ai.user.tab")}</TabsTrigger>
      </TabsList>

      <TabsContent value="profile" className="flex flex-col gap-8">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <h2 className="eyebrow">{t("admin.users.identity")}</h2>

          <FormField label={t("admin.users.name")}>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </FormField>

          <FormField label={t("admin.users.email")}>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </FormField>

          <label className="flex items-center gap-2.5">
            <input
              type="checkbox"
              checked={isAdmin}
              disabled={isSelf}
              onChange={(e) => setIsAdmin(e.target.checked)}
              className="size-4 accent-[var(--brand)]"
            />
            <span className="flex flex-col">
              <span className="text-[13px] font-medium text-[var(--text)]">
                {t("admin.users.isAdmin")}
              </span>
              <span className="text-[11.5px] text-[var(--text-faint)]">
                {isSelf ? t("admin.users.isAdminSelfHint") : t("admin.users.isAdminHint")}
              </span>
            </span>
          </label>

          <div>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {t("admin.users.save")}
            </button>
          </div>
        </form>

        <section className="flex flex-col gap-2">
          <h2 className="eyebrow">{t("admin.users.account")}</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-[13px]">
            <dt className="text-[var(--text-mut)]">{t("admin.users.signin")}</dt>
            <dd className="text-[var(--text)]">
              {profile.hasPassword
                ? t("admin.users.signinPassword")
                : t("admin.users.signinDiscord")}
            </dd>
            <dt className="text-[var(--text-mut)]">{t("admin.users.created")}</dt>
            <dd className="text-[var(--text)]">
              {new Date(profile.createdAt).toLocaleDateString(i18n.language)}
            </dd>
          </dl>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="eyebrow">{t("admin.users.networks")}</h2>
          {profile.networks.length === 0 ? (
            <p className="text-[12.5px] text-[var(--text-faint)]">{t("admin.users.noNetworks")}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {profile.networks.map((n) => (
                <li
                  key={n.id}
                  className="flex items-center justify-between rounded-[10px] bg-[var(--surface-raised)] px-3 py-2"
                >
                  <span className="truncate text-[13px] text-[var(--text)]">{n.name}</span>
                  <Badge variant="sage">{n.role}</Badge>
                </li>
              ))}
            </ul>
          )}
        </section>
      </TabsContent>

      <TabsContent value="ai">
        <UserAiTab userId={profile.id} />
      </TabsContent>
    </Tabs>
  );
}
