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
import { hasExistingSubscription } from "@/features/billing/subscriptionState";
import {
  type PackDto,
  type PlanDto,
  type SubscriptionDto,
  getPlans,
  getProjects,
  getSubscription,
  openPortal,
  startSubscriptionCheckout,
} from "@/lib/api/billing";
import { listMembers } from "@/lib/api/members";
import { type NetworkSummary, createNetwork, listNetworks } from "@/lib/api/networks";
import { pricingSignupUrl } from "@/lib/authReturn";
import { formatCredits, formatMoney } from "@/lib/format";
import { useAuthStore } from "@/state/authStore";
import { useNetworksStore } from "@/state/networksStore";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Coins,
  Layers3,
  ShieldCheck,
  Sparkles,
  Users,
  WandSparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { MarketingLayout } from "./MarketingLayout";

export function PricingPage() {
  const { t, i18n } = useTranslation();
  const user = useAuthStore((s) => s.currentUser);
  const [plans, setPlans] = useState<PlanDto[]>([]);
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
    getPlans()
      .then((items) => {
        if (!disposed) {
          setPlans(items);
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
  const selected = plans.find((plan) => plan.id === selectedId);
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
        <span className="marketing-kicker">
          <Sparkles size={15} />
          {t("marketing.pricing.label")}
        </span>
        <h1>{t("marketing.pricing.title")}</h1>
        <p>{t("marketing.pricing.intro")}</p>
      </section>
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
        {status === "ready" && plans.length === 0 && (
          <div className="pricing-state">
            <p>{t("marketing.pricing.empty")}</p>
            <Button asChild variant="primary">
              <a href="/demo">{t("marketing.pricing.demoCta")}</a>
            </Button>
          </div>
        )}
        {status === "ready" && selectedId && !selected && (
          <output className="pricing-notice">{t("marketing.pricing.selectionMissing")}</output>
        )}
        {status === "ready" && plans.length > 0 && (
          <div className={`pricing-plans ${plans.length === 1 ? "pricing-plans-single" : ""}`}>
            <div className="pricing-demo">
              <div className="pricing-demo-art" aria-hidden="true">
                <div />
                <div />
                <div />
                <div />
                <div />
                <div />
                <WandSparkles size={42} />
              </div>
              <h2>{t("marketing.pricing.demoTitle")}</h2>
              <p>{t("marketing.pricing.demoText")}</p>
              <Button asChild variant="outline" size="lg">
                <a href="/demo">
                  {t("marketing.pricing.demoCta")}
                  <ArrowUpRight size={17} />
                </a>
              </Button>
            </div>
            {plans.map((plan) => (
              <Card
                key={plan.id}
                className={`pricing-plan ${plan.highlighted ? "pricing-plan-featured" : ""}`}
              >
                <div className="pricing-plan-heading">
                  <h2>{plan.name}</h2>
                  {plan.highlighted && (
                    <span className="pricing-featured">
                      <Sparkles size={13} />
                      {t("marketing.pricing.featured")}
                    </span>
                  )}
                </div>
                <p className="pricing-plan-description">
                  {plan.description || t("marketing.pricing.planFallback")}
                </p>
                <div className="pricing-amount">
                  <strong>{formatMoney(plan.priceCents, plan.currency, i18n.language)}</strong>
                  <span>
                    {t(
                      plan.interval === "year"
                        ? "marketing.pricing.year"
                        : "marketing.pricing.month",
                    )}
                  </span>
                </div>
                <div className="pricing-quota">
                  <Sparkles size={20} />
                  <span>
                    {t(
                      plan.interval === "year"
                        ? "marketing.pricing.yearlyCredits"
                        : "marketing.pricing.monthlyCredits",
                      { credits: formatCredits(plan.creditsPerPeriod, i18n.language) },
                    )}
                  </span>
                </div>
                <ul className="pricing-benefits">
                  <li>
                    <Check size={16} />
                    <span>{t("marketing.pricing.shared")}</span>
                  </li>
                  <li>
                    <Check size={16} />
                    <span>
                      {plan.rolloverCap > 0
                        ? t("marketing.pricing.rollover", {
                            credits: formatCredits(plan.rolloverCap, i18n.language),
                          })
                        : t("marketing.pricing.noRollover")}
                    </span>
                  </li>
                  {plan.features
                    .split(/\r?\n/)
                    .map((feature) => feature.trim())
                    .filter(Boolean)
                    .map((feature, index) => (
                      <li key={`${index}-${feature}`}>
                        <Check size={16} />
                        <span>{feature}</span>
                      </li>
                    ))}
                </ul>
                {user ? (
                  <Button variant="primary" size="lg" onClick={() => setSelectedId(plan.id)}>
                    {t("marketing.pricing.choose", { name: plan.name })}
                    <ArrowUpRight size={17} />
                  </Button>
                ) : (
                  <Button asChild variant="primary" size="lg">
                    <a href={pricingSignupUrl(plan.id)}>
                      {t("marketing.pricing.choose", { name: plan.name })}
                      <ArrowUpRight size={17} />
                    </a>
                  </Button>
                )}
              </Card>
            ))}
          </div>
        )}
        <div className="pricing-trust">
          <ShieldCheck size={16} />
          <span>{t("marketing.pricing.secure")}</span>
          <span>{t("marketing.pricing.details")}</span>
        </div>
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
            href={user ? "/credits" : `/signup?${new URLSearchParams({ next: "/credits" })}`}
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
                <strong>{formatMoney(pack.priceCents, pack.currency, i18n.language)}</strong>
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
            {formatMoney(plan.priceCents, plan.currency, i18n.language)}
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
