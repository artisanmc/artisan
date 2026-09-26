import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Tooltip } from "@/components/ui/tooltip";
import { hasExistingSubscription } from "@/features/billing/subscriptionState";
import {
  type EditorOffer,
  type PackDto,
  type PlanDto,
  type SubscriptionDto,
  getEditorOffer,
  getPlans,
  getProjects,
  getSubscription,
  openPortal,
  startSubscriptionCheckout,
} from "@/lib/api/billing";
import { listMembers } from "@/lib/api/members";
import { type NetworkSummary, createNetwork, listNetworks } from "@/lib/api/networks";
import { pricingSignupUrl } from "@/lib/authReturn";
import { formatCredits } from "@/lib/format";
import { useAuthStore } from "@/state/authStore";
import { useNetworksStore } from "@/state/networksStore";
import {
  ArrowUpRight,
  ChevronDown,
  Coins,
  Info,
  Layers3,
  Server,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { MarketingLayout } from "./MarketingLayout";
import { editorHref } from "./marketingUrls";

export function PricingPage() {
  const { t, i18n } = useTranslation();
  const user = useAuthStore((s) => s.currentUser);
  const [plans, setPlans] = useState<PlanDto[]>([]);
  const [offer, setOffer] = useState<EditorOffer | null>(null);
  const [period, setPeriod] = useState<"month" | "year">("year");
  const [packs, setPacks] = useState<PackDto[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [packsFailed, setPacksFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [selectedId, setSelectedId] = useState(() =>
    new URLSearchParams(window.location.search).get("plan"),
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: The retry counter reloads the public catalog after a failure.
  useEffect(() => {
    let disposed = false;
    setStatus("loading");
    setPacksFailed(false);
    Promise.all([getPlans(), getEditorOffer()])
      .then(([items, offer]) => {
        if (!disposed) {
          setPlans(items);
          setOffer({
            quota: offer.quota,
            proQuota: offer.proQuota ?? 250,
            freeServers: offer.freeServers ?? 2,
            proServers: offer.proServers ?? 10,
            freeCollaborators: offer.freeCollaborators ?? 2,
            proMonthlyPriceCents: offer.proMonthlyPriceCents ?? 900,
            proYearlyPriceCents: offer.proYearlyPriceCents ?? 7000,
            proCreditsPerMonth: offer.proCreditsPerMonth ?? 500,
            currency: offer.currency ?? "eur",
          });
          setStatus("ready");
        }
      })
      .catch(() => {
        if (!disposed) setStatus("error");
      });
    getProjects()
      .then((items) => {
        if (!disposed) setPacks(items);
      })
      .catch(() => {
        if (!disposed) setPacksFailed(true);
      });
    return () => {
      disposed = true;
    };
  }, [retry]);
  const proPlans = plans.filter(
    (plan) =>
      plan.editorPro &&
      plan.purchasable !== false &&
      offer &&
      plan.currency === offer.currency &&
      plan.creditsPerPeriod === offer.proCreditsPerMonth &&
      ((plan.interval === "month" && plan.priceCents === offer.proMonthlyPriceCents) ||
        (plan.interval === "year" && plan.priceCents === offer.proYearlyPriceCents)),
  );
  const monthly = proPlans.find((plan) => plan.interval === "month");
  const yearly = proPlans.find((plan) => plan.interval === "year");
  const currentPlan = period === "year" ? yearly : monthly;
  const selected = proPlans.find((plan) => plan.id === selectedId);
  const annualSavings = offer ? offer.proMonthlyPriceCents * 12 - offer.proYearlyPriceCents : 0;
  const formattedSavings =
    offer && annualSavings > 0
      ? new Intl.NumberFormat(i18n.language, {
          style: "currency",
          currency: offer.currency,
          maximumFractionDigits: 0,
        }).format(annualSavings / 100)
      : null;
  const closeSelection = () => {
    setSelectedId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("plan");
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  };

  return (
    <MarketingLayout page="pricing">
      <section className="marketing-container pricing-hero">
        <h1>{t("marketing.pricing.title")}</h1>
      </section>
      <aside className="marketing-container pricing-promise">
        <ShieldCheck size={28} aria-hidden="true" />
        <div>
          <h2>{t("marketing.pricing.runtimePromise")}</h2>
          <p>{t("marketing.pricing.runtimeDetail")}</p>
        </div>
      </aside>
      <section
        className="marketing-container pricing-catalog"
        aria-label={t("marketing.pricing.plans")}
      >
        {status === "loading" && (
          <output className="pricing-state">
            <span className="pricing-loading" />
            {t("marketing.pricing.loading")}
          </output>
        )}
        {status === "error" && (
          <div className="pricing-state" role="alert">
            <p>{t("marketing.pricing.error")}</p>
            <Button variant="outline" onClick={() => setRetry((n) => n + 1)}>
              {t("marketing.pricing.retry")}
            </Button>
          </div>
        )}
        {status === "ready" && selectedId && !selected && (
          <output className="pricing-notice">{t("marketing.pricing.selectionMissing")}</output>
        )}
        {status === "ready" && offer && (
          <>
            <fieldset className="pricing-period border-0">
              <legend className="sr-only">{t("marketing.pricing.period")}</legend>
              <Button
                variant={period === "month" ? "primary" : "outline"}
                onClick={() => setPeriod("month")}
              >
                {t("marketing.pricing.monthly")}
              </Button>
              <Button
                className="pricing-annual-button"
                variant={period === "year" ? "primary" : "outline"}
                onClick={() => setPeriod("year")}
              >
                <span>{t("marketing.pricing.annual")}</span>
                {formattedSavings && (
                  <span className="pricing-annual-savings">
                    {t("marketing.pricing.annualSavingsShort", { savings: formattedSavings })}
                  </span>
                )}
              </Button>
            </fieldset>
            <div className="pricing-plans pricing-plans-two">
              <Card className="pricing-plan">
                <div className="pricing-plan-heading">
                  <h2>{t("marketing.pricing.freeName")}</h2>
                </div>
                <p className="pricing-plan-description">{t("marketing.pricing.freeDescription")}</p>
                <div className="pricing-price-block">
                  <div className="pricing-amount">
                    <strong>{formatPrice(0, "eur", i18n.language)}</strong>
                  </div>
                </div>
                <PricingLimits
                  resources={offer.quota}
                  servers={offer.freeServers}
                  collaborators={offer.freeCollaborators}
                />
                <Button asChild variant="outline" size="lg">
                  <a href={editorHref("/networks")}>{t("marketing.pricing.openEditor")}</a>
                </Button>
              </Card>
              <Card className="pricing-plan pricing-plan-featured">
                <div className="pricing-plan-heading">
                  <h2>{t("marketing.pricing.proName")}</h2>
                </div>
                <p className="pricing-plan-description">{t("marketing.pricing.proDescription")}</p>
                <div className="pricing-price-block">
                  <div className="pricing-amount">
                    <strong>
                      {formatPrice(
                        period === "year" ? offer.proYearlyPriceCents : offer.proMonthlyPriceCents,
                        offer.currency,
                        i18n.language,
                      )}
                    </strong>
                    <span>
                      {t(period === "year" ? "marketing.pricing.year" : "marketing.pricing.month")}
                    </span>
                  </div>
                  <p className="pricing-plan-scope">{t("marketing.pricing.priceScope")}</p>
                </div>
                <PricingLimits
                  resources={offer.proQuota}
                  servers={offer.proServers}
                  collaborators={null}
                  creditsPerMonth={offer.proCreditsPerMonth}
                />
                {currentPlan &&
                  (user ? (
                    <Button
                      variant="primary"
                      size="lg"
                      onClick={() => setSelectedId(currentPlan.id)}
                    >
                      {t("marketing.pricing.proCta")}
                    </Button>
                  ) : (
                    <Button asChild variant="primary" size="lg">
                      <a href={editorHref(pricingSignupUrl(currentPlan.id))}>
                        {t("marketing.pricing.proCta")}
                      </a>
                    </Button>
                  ))}
                {!currentPlan && (
                  <p className="pricing-plan-availability">
                    {t("marketing.pricing.proAvailability")}
                  </p>
                )}
              </Card>
            </div>
          </>
        )}
        {currentPlan && (
          <div className="pricing-trust">
            <ShieldCheck size={16} />
            <span>{t("marketing.pricing.secure")}</span>
            <span>{t("marketing.pricing.details")}</span>
          </div>
        )}
      </section>
      <section className="marketing-container pricing-topups">
        <div>
          <span className="marketing-kicker">
            <Coins size={16} />
            {t("marketing.pricing.creditLabel")}
          </span>
          <h2>{t("marketing.pricing.packsTitle")}</h2>
          <p>{t("marketing.pricing.packsText")}</p>
          <a
            className="marketing-text-link"
            href={editorHref(
              user ? "/credits" : `/signup?${new URLSearchParams({ next: "/credits" })}`,
            )}
          >
            {t("marketing.pricing.packsCta")}
            <ArrowUpRight size={16} />
          </a>
        </div>
        <div className="pricing-pack-list">
          {packsFailed ? (
            <p>{t("marketing.pricing.packsError")}</p>
          ) : (
            packs.map((pack) => (
              <div key={pack.id} className="pricing-pack">
                <Coins size={18} />
                <div>
                  <strong>{pack.name}</strong>
                  <span>
                    {t("marketing.pricing.packCredits", {
                      credits: formatCredits(pack.creditsGranted, i18n.language),
                    })}
                  </span>
                </div>
                <strong>{formatPrice(pack.priceCents, pack.currency, i18n.language)}</strong>
              </div>
            ))
          )}
        </div>
      </section>
      <section className="marketing-container pricing-explain">
        <h2>{t("marketing.pricing.howTitle")}</h2>
        <p>{t("marketing.pricing.howIntro")}</p>
        <div className="pricing-how-grid">
          {[
            { id: 1, Icon: Layers3 },
            { id: 2, Icon: Users },
            { id: 3, Icon: Coins },
          ].map(({ id, Icon }) => (
            <article key={id}>
              <Icon size={24} />
              <h3>{t(`marketing.pricing.how${id}Title`)}</h3>
              <p>{t(`marketing.pricing.how${id}`)}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="marketing-container pricing-faq">
        <div>
          <h2>{t("marketing.pricing.faqTitle")}</h2>
          <a className="marketing-text-link" href="/wiki/editor/credits/">
            {t("marketing.pricing.wiki")}
            <ArrowUpRight size={16} />
          </a>
        </div>
        <div>
          {[1, 2, 3, 4].map((n) => (
            <details key={n}>
              <summary>
                {t(`marketing.pricing.faq${n}Q`)}
                <ChevronDown size={17} />
              </summary>
              <p>{t(`marketing.pricing.faq${n}A`)}</p>
            </details>
          ))}
        </div>
      </section>
      {selected && user && (
        <PlanCheckout key={`${user.id}-${selected.id}`} plan={selected} onClose={closeSelection} />
      )}
    </MarketingLayout>
  );
}

function formatPrice(cents: number, currency: string, language: string): string {
  return new Intl.NumberFormat(language, {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function PricingLimits({
  resources,
  servers,
  collaborators,
  creditsPerMonth,
}: { resources: number; servers: number; collaborators: number | null; creditsPerMonth?: number }) {
  const { t } = useTranslation();
  return (
    <ul className="pricing-limits">
      <li>
        <Layers3 size={20} aria-hidden="true" />
        <span>{t("marketing.pricing.resourcesPerServer", { count: resources })}</span>
        <Tooltip content={t("marketing.pricing.moduleTooltip")}>
          <button
            type="button"
            className="pricing-limit-info"
            aria-label={t("marketing.pricing.moduleInfo")}
          >
            <Info size={16} />
          </button>
        </Tooltip>
      </li>
      <li>
        <Server size={20} aria-hidden="true" />
        <span>{t("marketing.pricing.servers", { count: servers })}</span>
      </li>
      <li>
        <Users size={20} aria-hidden="true" />
        <span>
          {collaborators === null
            ? t("marketing.pricing.unlimitedCollaborators")
            : t("marketing.pricing.collaborators", { count: collaborators })}
        </span>
      </li>
      {creditsPerMonth !== undefined && (
        <li>
          <Coins size={20} aria-hidden="true" />
          <span>{t("marketing.pricing.creditsPerMonth", { count: creditsPerMonth })}</span>
        </li>
      )}
    </ul>
  );
}

function PlanCheckout({ plan, onClose }: { plan: PlanDto; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const user = useAuthStore((s) => s.currentUser)!;
  const [networks, setNetworks] = useState<NetworkSummary[]>([]);
  const [networkId, setNetworkId] = useState("");
  const [networkName, setNetworkName] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [access, setAccess] = useState<"loading" | "allowed" | "forbidden" | "error">("loading");
  const [subscription, setSubscription] = useState<SubscriptionDto | null>(null);
  const [busy, setBusy] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Recheck account-scoped networks on identity change and explicit retry.
  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setError(null);
    listNetworks()
      .then((items) => {
        if (disposed) return;
        setNetworks(items);
        const activeId = useNetworksStore.getState().activeId;
        setNetworkId((previous) =>
          items.some((network) => network.id === previous)
            ? previous
            : items.some((network) => network.id === activeId)
              ? activeId!
              : (items[0]?.id ?? ""),
        );
        setLoading(false);
      })
      .catch(() => {
        if (!disposed) {
          setError("networkError");
          setLoading(false);
        }
      });
    return () => {
      disposed = true;
    };
  }, [user.id, retry]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: The retry counter rechecks permissions after a failed request.
  useEffect(() => {
    if (!networkId) return;
    let disposed = false;
    setAccess("loading");
    setSubscription(null);
    setError(null);
    Promise.all([listMembers(networkId), getSubscription(networkId)])
      .then(([members, sub]) => {
        if (disposed) return;
        if (!sub) {
          setAccess("error");
          return;
        }
        const role = members.find((member) => member.userId === user.id)?.role;
        setSubscription(sub);
        setAccess(role === "owner" || role === "admin" ? "allowed" : "forbidden");
      })
      .catch(() => {
        if (!disposed) setAccess("error");
      });
    return () => {
      disposed = true;
    };
  }, [networkId, user.id, retry]);

  async function addNetwork(event: React.FormEvent) {
    event.preventDefault();
    if (!networkName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const network = await createNetwork(networkName.trim());
      setNetworks([network]);
      setNetworkId(network.id);
      useNetworksStore.getState().upsertNetwork(network);
    } catch {
      setError("networkError");
    } finally {
      setBusy(false);
    }
  }
  async function checkout() {
    if (busy || access !== "allowed" || !networkId) return;
    setBusy(true);
    setError(null);
    try {
      // Recheck before leaving: another administrator may have subscribed while this dialog was open.
      const latest = await getSubscription(networkId);
      if (!latest) throw new Error("billing_unavailable");
      setSubscription(latest);
      const url = hasExistingSubscription(latest)
        ? await openPortal(networkId)
        : await startSubscriptionCheckout(networkId, plan.id);
      if (!url) throw new Error("checkout_unavailable");
      useNetworksStore.getState().setActiveId(networkId);
      window.location.assign(url);
    } catch {
      setError("checkoutError");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="pricing-checkout">
        <DialogHeader>
          <DialogTitle>{t("marketing.pricing.selected", { name: plan.name })}</DialogTitle>
          <DialogDescription>{t("marketing.pricing.networkIntro")}</DialogDescription>
        </DialogHeader>
        <div className="pricing-checkout-summary">
          <span>{plan.name}</span>
          <strong>
            {formatPrice(plan.priceCents, plan.currency, i18n.language)}
            {t(plan.interval === "year" ? "marketing.pricing.year" : "marketing.pricing.month")}
          </strong>
        </div>
        {loading ? (
          <output>{t("marketing.pricing.networkLoading")}</output>
        ) : networks.length === 0 && !error ? (
          <form onSubmit={addNetwork}>
            <p>{t("marketing.pricing.noNetwork")}</p>
            <FormField label={t("marketing.pricing.networkName")}>
              <input
                className="input"
                required
                maxLength={100}
                value={networkName}
                placeholder={t("marketing.pricing.networkNew")}
                onChange={(e) => setNetworkName(e.target.value)}
              />
            </FormField>
            <Button variant="primary" disabled={busy || !networkName.trim()} type="submit">
              {t(busy ? "marketing.pricing.busy" : "marketing.pricing.createNetwork")}
            </Button>
          </form>
        ) : networks.length > 0 ? (
          <>
            <FormField label={t("marketing.pricing.networkLabel")}>
              <select
                className="input"
                value={networkId}
                disabled={busy}
                onChange={(e) => setNetworkId(e.target.value)}
              >
                {networks.map((network) => (
                  <option key={network.id} value={network.id}>
                    {network.name}
                  </option>
                ))}
              </select>
            </FormField>
            {access === "loading" && <output>{t("marketing.pricing.checking")}</output>}
            {access === "forbidden" && <p role="alert">{t("marketing.pricing.permission")}</p>}
            {access === "error" && (
              <>
                <p role="alert">{t("marketing.pricing.membersError")}</p>
                <Button variant="outline" onClick={() => setRetry((n) => n + 1)}>
                  {t("marketing.pricing.retry")}
                </Button>
              </>
            )}
            {access === "allowed" && (
              <>
                {hasExistingSubscription(subscription) && <p>{t("marketing.pricing.existing")}</p>}
                <Button variant="primary" disabled={busy} onClick={checkout}>
                  {t(
                    busy
                      ? "marketing.pricing.busy"
                      : hasExistingSubscription(subscription)
                        ? "marketing.pricing.manage"
                        : "marketing.pricing.checkout",
                  )}
                </Button>
              </>
            )}
          </>
        ) : null}
        {error && (
          <div role="alert">
            <p>{t(`marketing.pricing.${error}`)}</p>
            {error === "networkError" && (
              <Button variant="outline" onClick={() => setRetry((n) => n + 1)}>
                {t("marketing.pricing.retry")}
              </Button>
            )}
          </div>
        )}
        <p className="pricing-checkout-trust">
          <ShieldCheck size={15} />
          {t("marketing.pricing.secure")}
        </p>
      </DialogContent>
    </Dialog>
  );
}
