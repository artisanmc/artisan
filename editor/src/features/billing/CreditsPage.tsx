import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { CreditIndicator } from "@/features/billing/CreditIndicator";
import {
  type BalanceBreakdown,
  type PackDto,
  type PlanDto,
  type PurchaseDto,
  type SubscriptionDto,
  getBillingBalance,
  getPlans,
  getProjects,
  getPurchases,
  getSubscription,
  openPortal,
  startPackCheckout,
  startSubscriptionCheckout,
} from "@/lib/api/billing";
import { listMembers } from "@/lib/api/members";
import { formatCredits, formatMoney } from "@/lib/format";
import { useAuthStore } from "@/state/authStore";
import { useNetworksStore } from "@/state/networksStore";
import { Link, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { hasExistingSubscription } from "./subscriptionState";

type Banner = "success" | "cancel" | "error" | null;

/** Subscription status → Badge variant (green healthy, amber overdue, red canceled). */
function statusVariant(status: string | null | undefined): "sage" | "amber" | "brick" {
  if (status === "past_due") return "amber";
  if (status === "canceled" || status === "unpaid") return "brick";
  return "sage";
}
/** Subscription status → translated label (never render the raw backend enum). */
function statusLabel(t: (k: string) => string, status: string | null | undefined): string {
  if (status === "past_due") return t("billing.page.statusPastDue");
  if (status === "canceled" || status === "unpaid") return t("billing.page.statusCanceled");
  return t("billing.page.statusActive");
}

export function CreditsPage() {
  const { t, i18n } = useTranslation();
  const currentUser = useAuthStore((s) => s.currentUser);
  const storedActiveId = useNetworksStore((s) => s.activeId);
  const search = useSearch({ strict: false }) as { checkout?: string; networkId?: string };
  const activeId = search.networkId || storedActiveId;

  const [balance, setBalance] = useState<BalanceBreakdown | null>(null);
  const [projects, setProjects] = useState<PackDto[]>([]);
  const [plans, setPlans] = useState<PlanDto[]>([]);
  const [subscription, setSubscription] = useState<SubscriptionDto | null>(null);
  const [purchases, setPurchases] = useState<PurchaseDto[]>([]);
  const [banner, setBanner] = useState<Banner>(null);
  const [canManage, setCanManage] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: The retry counter explicitly refreshes authoritative billing data.
  useEffect(() => {
    if (!currentUser || !activeId) return;
    let cancelled = false;
    setCanManage(false);
    setLoadError(false);
    setLoading(true);
    setBalance(null);
    setPlans([]);
    setProjects([]);
    setSubscription(null);
    setPurchases([]);
    (async () => {
      const [b, pk, pl, sub, pur, members] = await Promise.all([
        getBillingBalance(activeId),
        getProjects(),
        getPlans(),
        getSubscription(activeId),
        getPurchases(activeId),
        listMembers(activeId),
      ]);
      if (cancelled) return;
      if (!b || !sub) throw new Error("billing_unavailable");
      const role = members.find((member) => member.userId === currentUser.id)?.role;
      setCanManage(role === "owner" || role === "admin");
      setBalance(b);
      setProjects(pk);
      setPlans(pl);
      setSubscription(sub);
      setPurchases(pur);
      useNetworksStore.getState().setActiveId(activeId);
    })()
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUser, activeId, retry]);

  useEffect(() => {
    if (!activeId) return;
    if (search.checkout === "success") {
      setBanner("success");
    } else if (search.checkout === "cancel") {
      setBanner("cancel");
    } else setBanner(null);
  }, [search.checkout, activeId]);

  if (!currentUser) {
    return (
      <EmptyState
        title={t("billing.page.signedOut")}
        action={
          <Link to="/login" className="btn btn-primary">
            {t("auth.loginSubmit")}
          </Link>
        }
      />
    );
  }

  if (!activeId) {
    return (
      <EmptyState
        title={t("billing.page.pickNetwork")}
        action={
          <Button asChild variant="primary">
            <a href="/networks">{t("marketing.nav.workspace")}</a>
          </Button>
        }
      />
    );
  }

  async function buyProject(projectId: string) {
    if (!canManage || busy) return;
    setBusy(true);
    try {
      const url = await startPackCheckout(activeId as string, projectId);
      if (url) window.location.assign(url);
      else setBanner("error");
    } catch {
      setBanner("error");
    } finally {
      setBusy(false);
    }
  }

  async function subscribeToPlan(planId: string) {
    if (!canManage || busy) return;
    setBusy(true);
    try {
      const latest = await getSubscription(activeId as string);
      if (!latest) throw new Error("billing_unavailable");
      setSubscription(latest);
      const url = hasExistingSubscription(latest)
        ? await openPortal(activeId as string)
        : await startSubscriptionCheckout(activeId as string, planId);
      if (url) window.location.assign(url);
      else setBanner("error");
    } catch {
      setBanner("error");
    } finally {
      setBusy(false);
    }
  }

  async function manageSubscription() {
    if (!canManage || busy) return;
    setBusy(true);
    try {
      const url = await openPortal(activeId as string);
      if (url) window.location.assign(url);
      else setBanner("error");
    } catch {
      setBanner("error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 overflow-y-auto p-6">
      <div className="flex flex-col gap-1">
        <h1 className="display text-[28px] tracking-tight text-[var(--text)]">
          {t("billing.page.title")}
        </h1>
        <p className="text-[14px] text-[var(--text-mut)]">{t("billing.page.subtitle")}</p>
      </div>
      {loading && <output>{t("marketing.pricing.loading")}</output>}
      {loadError && (
        <div role="alert" className="card flex flex-wrap items-center gap-4 p-4">
          <p>{t("marketing.pricing.error")}</p>
          <Button variant="outline" onClick={() => setRetry((n) => n + 1)}>
            {t("marketing.pricing.retry")}
          </Button>
        </div>
      )}
      {!loading && !loadError && !canManage && <p>{t("marketing.pricing.permission")}</p>}

      {banner && (
        <div className="card flex items-center justify-between px-4 py-2 text-[13px]">
          <span>
            {banner === "success" && t("marketing.pricing.pending")}
            {banner === "cancel" && t("marketing.pricing.canceled")}
            {banner === "error" && t("billing.page.checkoutError")}
          </span>
          {banner === "success" && (
            <Button variant="outline" size="sm" onClick={() => setRetry((n) => n + 1)}>
              {t("marketing.pricing.refresh")}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setBanner(null)}>
            ×
          </Button>
        </div>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="eyebrow">{t("billing.page.balanceHeading")}</h2>
        <CreditIndicator balance={balance} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="eyebrow">{t("billing.page.packsHeading")}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Card key={project.id}>
              <CardHeader>
                <CardTitle>{project.name}</CardTitle>
                <div className="flex items-center gap-2 text-[13px] text-[var(--text-mut)]">
                  <span>{formatMoney(project.priceCents, project.currency, i18n.language)}</span>
                  {project.bonusPct > 0 && (
                    <Badge variant="sage">
                      {t("billing.page.bonus", { pct: project.bonusPct })}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-[13px] text-[var(--text)]">
                  {t("billing.page.creditsFor", {
                    credits: formatCredits(project.creditsGranted, i18n.language),
                  })}
                </p>
              </CardContent>
              <CardFooter>
                <Button
                  variant="primary"
                  disabled={!canManage || busy}
                  onClick={() => buyProject(project.id)}
                >
                  {t("billing.page.buy")}
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="eyebrow">{t("billing.page.plansHeading")}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => (
            <Card key={plan.id}>
              <CardHeader>
                <CardTitle>{plan.name}</CardTitle>
                <div className="text-[13px] text-[var(--text-mut)]">
                  {formatMoney(plan.priceCents, plan.currency, i18n.language)}
                  {t(
                    plan.interval === "year" ? "marketing.pricing.year" : "marketing.pricing.month",
                  )}
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-1">
                <p className="text-[13px] text-[var(--text)]">
                  {t("billing.page.creditsFor", {
                    credits: formatCredits(plan.creditsPerPeriod, i18n.language),
                  })}
                </p>
                {plan.features && (
                  <p className="text-[12.5px] text-[var(--text-mut)]">{plan.features}</p>
                )}
              </CardContent>
              <CardFooter>
                {subscription?.planId === plan.id && hasExistingSubscription(subscription) ? (
                  <Badge variant="sage">{t("billing.page.active")}</Badge>
                ) : (
                  <Button
                    variant="primary"
                    disabled={!canManage || busy}
                    onClick={() => subscribeToPlan(plan.id)}
                  >
                    {t(
                      hasExistingSubscription(subscription)
                        ? "billing.page.manage"
                        : "billing.page.subscribe",
                    )}
                  </Button>
                )}
              </CardFooter>
            </Card>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="eyebrow">{t("billing.page.mySubscription")}</h2>
        {subscription?.status ? (
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
              <div className="flex items-center gap-2">
                <Badge variant={statusVariant(subscription.status)}>
                  {statusLabel(t, subscription.status)}
                </Badge>
                {subscription.currentPeriodEnd && (
                  <span className="text-[13px] text-[var(--text-mut)]">
                    {t("billing.page.renewsOn", {
                      date: new Date(subscription.currentPeriodEnd).toLocaleDateString(
                        i18n.language,
                      ),
                    })}
                  </span>
                )}
                {subscription.graceUntil && (
                  <span className="text-[13px] text-[var(--warning)]">
                    {t("billing.page.graceUntil", {
                      date: new Date(subscription.graceUntil).toLocaleDateString(i18n.language),
                    })}
                  </span>
                )}
              </div>
              <Button variant="outline" disabled={!canManage || busy} onClick={manageSubscription}>
                {t("billing.page.manage")}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <EmptyState title={t("billing.page.noSubscription")} />
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="eyebrow">{t("billing.page.history")}</h2>
        {purchases.length === 0 ? (
          <EmptyState title={t("billing.page.noPurchases")} />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>{t("billing.page.colDate")}</TH>
                <TH align="right">{t("billing.page.colAmount")}</TH>
                <TH align="right">{t("billing.page.colCredits")}</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {purchases.map((purchase) => (
                <TR key={purchase.id}>
                  <TD>{new Date(purchase.createdAt).toLocaleDateString(i18n.language)}</TD>
                  <TD align="right">
                    {formatMoney(purchase.amountCents, purchase.currency, i18n.language)}
                  </TD>
                  <TD align="right">{formatCredits(purchase.credits, i18n.language)}</TD>
                  <TD>
                    {purchase.stripeInvoiceUrl && (
                      <a
                        href={purchase.stripeInvoiceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[var(--brand)] underline-offset-2 hover:underline"
                      >
                        {t("billing.page.invoice")}
                      </a>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </section>
    </div>
  );
}
