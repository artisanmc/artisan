import {
  getBillingBalance,
  getPacks,
  getPlans,
  getPurchases,
  getSubscription,
  openPortal,
  startPackCheckout,
  startSubscriptionCheckout,
  type BalanceBreakdown,
  type PackDto,
  type PlanDto,
  type PurchaseDto,
  type SubscriptionDto,
} from "@/lib/api/billing";
import { formatCredits, formatMoney } from "@/lib/format";
import { useAuthStore } from "@/state/authStore";
import { useNetworksStore } from "@/state/networksStore";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { CreditIndicator } from "@/features/billing/CreditIndicator";
import { Link, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type Banner = "success" | "cancel" | "error" | null;

export function CreditsPage() {
  const { t, i18n } = useTranslation();
  const currentUser = useAuthStore((s) => s.currentUser);
  const activeId = useNetworksStore((s) => s.activeId);
  const search = useSearch({ strict: false }) as { checkout?: string };

  const [balance, setBalance] = useState<BalanceBreakdown | null>(null);
  const [packs, setPacks] = useState<PackDto[]>([]);
  const [plans, setPlans] = useState<PlanDto[]>([]);
  const [subscription, setSubscription] = useState<SubscriptionDto | null>(null);
  const [purchases, setPurchases] = useState<PurchaseDto[]>([]);
  const [banner, setBanner] = useState<Banner>(null);

  useEffect(() => {
    if (!currentUser || !activeId) return;
    let cancelled = false;
    (async () => {
      const [b, pk, pl, sub, pur] = await Promise.all([
        getBillingBalance(activeId),
        getPacks(),
        getPlans(),
        getSubscription(activeId),
        getPurchases(activeId),
      ]);
      if (cancelled) return;
      setBalance(b);
      setPacks(pk);
      setPlans(pl);
      setSubscription(sub);
      setPurchases(pur);
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser, activeId]);

  useEffect(() => {
    if (!activeId) return;
    if (search.checkout === "success") {
      setBanner("success");
      getBillingBalance(activeId).then((b) => setBalance(b));
    } else if (search.checkout === "cancel") {
      setBanner("cancel");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    return <EmptyState title={t("billing.page.pickNetwork")} />;
  }

  async function buyPack(packId: string) {
    const url = await startPackCheckout(activeId as string, packId);
    if (url) window.location.assign(url);
    else setBanner("error");
  }

  async function subscribeToPlan(planId: string) {
    const url = await startSubscriptionCheckout(activeId as string, planId);
    if (url) window.location.assign(url);
    else setBanner("error");
  }

  async function manageSubscription() {
    const url = await openPortal(activeId as string);
    if (url) window.location.assign(url);
    else setBanner("error");
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="display text-[28px] tracking-tight text-[var(--text)]">
          {t("billing.page.title")}
        </h1>
        <p className="text-[14px] text-[var(--text-mut)]">{t("billing.page.subtitle")}</p>
      </div>

      {banner && (
        <div className="card flex items-center justify-between px-4 py-2 text-[13px]">
          <span>
            {banner === "success" && t("billing.page.checkoutSuccess")}
            {banner === "cancel" && t("billing.page.checkoutCancel")}
            {banner === "error" && t("billing.page.checkoutError")}
          </span>
          <Button variant="ghost" size="sm" onClick={() => setBanner(null)}>
            ×
          </Button>
        </div>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="eyebrow">{t("billing.page.balanceHeading")}</h2>
        <CreditIndicator balance={balance} onRecharge={() => {}} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="eyebrow">{t("billing.page.packsHeading")}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {packs.map((pack) => (
            <Card key={pack.id}>
              <CardHeader>
                <CardTitle>{pack.name}</CardTitle>
                <div className="flex items-center gap-2 text-[13px] text-[var(--text-mut)]">
                  <span>{formatMoney(pack.priceCents, pack.currency, i18n.language)}</span>
                  {pack.bonusPct > 0 && (
                    <Badge variant="sage">{t("billing.page.bonus", { pct: pack.bonusPct })}</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-[13px] text-[var(--text)]">
                  {t("billing.page.creditsFor", { credits: formatCredits(pack.credits, i18n.language) })}
                </p>
              </CardContent>
              <CardFooter>
                <Button variant="primary" onClick={() => buyPack(pack.id)}>
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
                  {t("billing.page.perMonth")}
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
                {subscription?.planId === plan.id ? (
                  <Badge variant="sage">{t("billing.page.active")}</Badge>
                ) : (
                  <Button variant="primary" onClick={() => subscribeToPlan(plan.id)}>
                    {t("billing.page.subscribe")}
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
                <Badge variant="sage">{subscription.status}</Badge>
                {subscription.currentPeriodEnd && (
                  <span className="text-[13px] text-[var(--text-mut)]">
                    {t("billing.page.renewsOn", {
                      date: new Date(subscription.currentPeriodEnd).toLocaleDateString(i18n.language),
                    })}
                  </span>
                )}
              </div>
              <Button variant="outline" onClick={manageSubscription}>
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
