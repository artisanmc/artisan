import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ApiError } from "@/lib/api/client";
import { type McpGrants, listMcpGrants, revokeMcpGrant, setMcpGrantPublish } from "@/lib/api/mcp";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * The AI clients the player connected through the MCP endpoint (ADR
 * `mcp-server`), each one revocable: its next call is refused. A client
 * prepares drafts; it deploys only once the player switches that on, which
 * takes the player's own right to deploy.
 */
export function McpAppsSection() {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState<McpGrants | "disabled" | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const address = `${window.location.origin}/mcp`;

  useEffect(() => {
    listMcpGrants()
      .then(setState)
      .catch((e) =>
        setState(
          e instanceof ApiError && e.code === "not_found"
            ? "disabled"
            : { grants: [], canPublish: false },
        ),
      );
  }, []);

  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

  const revoke = async (id: string) => {
    setFailed(false);
    try {
      await revokeMcpGrant(id);
      setState((current) =>
        typeof current === "object"
          ? { ...current, grants: current.grants.filter((g) => g.id !== id) }
          : current,
      );
    } catch {
      setFailed(true);
    }
  };

  const allowPublish = async (id: string, publish: boolean) => {
    setFailed(false);
    try {
      await setMcpGrantPublish(id, publish);
      setState((current) =>
        typeof current === "object"
          ? {
              ...current,
              grants: current.grants.map((g) => (g.id === id ? { ...g, publish } : g)),
            }
          : current,
      );
    } catch {
      setFailed(true);
    }
  };

  if (state === undefined)
    return <p className="text-[13px] text-[var(--text-mut)]">{t("mcp.apps.loading")}</p>;
  if (state === "disabled")
    return <p className="text-[13px] text-[var(--text-mut)]">{t("mcp.apps.disabled")}</p>;
  const { grants, canPublish } = state;

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <span className="field-label">{t("mcp.apps.howTo")}</span>
        <div className="flex items-center gap-2">
          <code className="input flex-1 truncate font-mono text-[13px]">{address}</code>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void navigator.clipboard?.writeText(address);
              setCopied(true);
            }}
          >
            {copied ? t("mcp.apps.copied") : t("mcp.apps.copy")}
          </Button>
        </div>
      </div>
      <div className="rule" />
      {grants.length === 0 ? (
        <p className="text-[13px] text-[var(--text-mut)]">{t("mcp.apps.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {grants.map((grant) => (
            <li key={grant.id} className="card flex items-center justify-between gap-4 p-4">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-[14px] font-semibold text-[var(--text)]">
                  {grant.client}
                </span>
                <span className="text-[12px] text-[var(--text-mut)]">
                  {t("mcp.apps.since", {
                    date: date(grant.createdAt),
                    used: date(grant.lastUsedAt),
                  })}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-4">
                <div className="flex items-center gap-2 text-[12px] text-[var(--text-mut)]">
                  <Switch
                    id={`publish-${grant.id}`}
                    checked={grant.publish}
                    disabled={!canPublish && !grant.publish}
                    title={canPublish ? undefined : t("mcp.apps.publishNeedsRight")}
                    onCheckedChange={(publish) => void allowPublish(grant.id, publish)}
                  />
                  <label htmlFor={`publish-${grant.id}`}>{t("mcp.apps.publish")}</label>
                </div>
                <Button variant="destructive" size="sm" onClick={() => void revoke(grant.id)}>
                  {t("mcp.apps.revoke")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {failed && <p className="text-[13px] text-[var(--danger)]">{t("mcp.apps.failed")}</p>}
    </section>
  );
}
