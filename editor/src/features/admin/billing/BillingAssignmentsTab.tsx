import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import {
  type AdminPlan,
  type NetworkPlanAssignment,
  assignNetworkPlan,
  getNetworkPlan,
  listBillingNetworks,
  listPlans,
} from "@/lib/api/adminBilling";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const key = "billing.catalog.assignment.";

export function BillingAssignmentsTab() {
  const { t } = useTranslation();
  const [networks, setNetworks] = useState<{ id: string; name: string }[]>([]);
  const [plans, setPlans] = useState<AdminPlan[]>([]);
  const [networkId, setNetworkId] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    void Promise.all([listBillingNetworks(), listPlans()])
      .then(([items, offers]) => {
        if (!offers) throw new Error("plans_unavailable");
        if (live) {
          setNetworks(items);
          setPlans(offers);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{t(`${key}title`)}</h2>
      <p className="text-sm text-[var(--text-mut)]">{t(`${key}description`)}</p>
      {failed ? (
        <p role="alert">{t(`${key}fail`)}</p>
      ) : !loaded ? (
        <p>{t(`${key}loading`)}</p>
      ) : (
        <>
          <FormField label={t(`${key}network`)} htmlFor="assignment-network">
            <select
              id="assignment-network"
              className="input"
              value={networkId}
              onChange={(e) => setNetworkId(e.target.value)}
            >
              <option value="">{t(`${key}chooseNetwork`)}</option>
              {networks.map((network) => (
                <option key={network.id} value={network.id}>
                  {network.name}
                </option>
              ))}
            </select>
          </FormField>
          {networkId && <AssignmentForm key={networkId} networkId={networkId} plans={plans} />}
        </>
      )}
    </div>
  );
}

function AssignmentForm({ networkId, plans }: { networkId: string; plans: AdminPlan[] }) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState<NetworkPlanAssignment | null>(null);
  const [planId, setPlanId] = useState("");
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    let live = true;
    void getNetworkPlan(networkId)
      .then((value) => {
        if (!live) return;
        setCurrent(value);
        if (value.assignment && value.effectivePlan.planId === value.assignment.planId) {
          setPlanId(value.assignment.planId);
          if (value.assignment.expiresAt) {
            const date = new Date(value.assignment.expiresAt);
            setExpires(
              new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
                .toISOString()
                .slice(0, -1),
            );
          }
        }
      })
      .catch(() => {
        if (live) setMessage({ ok: false, text: t(`${key}fail`) });
      });
    return () => {
      live = false;
    };
  }, [networkId, t]);
  const eligible = plans.filter(
    (plan) =>
      plan.key !== "free" &&
      plan.isActive &&
      plan.publicationStatus === "published" &&
      (plan.audience === "public" || plan.targetNetworkId === networkId),
  );
  const selected = plans.find((plan) => plan.id === planId);
  async function submit() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await assignNetworkPlan(
        networkId,
        planId || null,
        planId && expires ? new Date(expires).toISOString() : null,
      );
      if (!result.ok) {
        const code = ["invalid_expiration", "plan_not_available", "subscription_exists"].includes(
          result.error ?? "",
        )
          ? result.error
          : "fail";
        setMessage({ ok: false, text: t(`${key}${code}`) });
      } else {
        setCurrent(await getNetworkPlan(networkId));
        setMessage({ ok: true, text: t(`${key}saved`) });
      }
    } catch {
      setMessage({ ok: false, text: t(`${key}fail`) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card flex max-w-xl flex-col gap-4 p-4">
      {current && (
        <>
          <p>{t("billing.catalog.effectivePlan", { name: current.effectivePlan.planName })}</p>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <FormField label={t(`${key}plan`)} htmlFor="assignment-plan">
              <select
                id="assignment-plan"
                className="input"
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
                disabled={busy}
              >
                <option value="">{t(`${key}free`)}</option>
                {selected && !eligible.some((plan) => plan.id === selected.id) && (
                  <option value={selected.id} disabled>
                    {selected.name} · v{selected.version}
                  </option>
                )}
                {eligible.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name} · v{plan.version} · {t(`billing.catalog.billed_${plan.interval}`)}
                  </option>
                ))}
              </select>
            </FormField>
            {selected && (
              <p className="text-sm text-[var(--text-mut)]">
                {selected.creditInterval === "none"
                  ? t(`${key}none`)
                  : t(`billing.catalog.credits_${selected.creditInterval}`, {
                      credits: selected.creditsPerPeriod,
                    })}
              </p>
            )}
            <FormField label={t(`${key}expires`)} htmlFor="assignment-expires">
              <Input
                id="assignment-expires"
                type="datetime-local"
                step="any"
                value={expires}
                onChange={(e) => setExpires(e.target.value)}
                disabled={busy || !planId}
              />
            </FormField>
            <p className="text-sm text-[var(--text-mut)]">{t(`${key}expiryHint`)}</p>
            <Button type="submit" disabled={busy}>
              {t(`${key}save`)}
            </Button>
          </form>
        </>
      )}
      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          className={message.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
