import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/client";
import { type McpGrant, listMcpGrants, revokeMcpGrant } from "@/lib/api/mcp";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * The AI clients the player connected through the MCP endpoint (ADR
 * `mcp-server`), each one revocable: its next call is refused.
 */
export function McpAppsSection() {
  const { t, i18n } = useTranslation();
  const [grants, setGrants] = useState<McpGrant[] | "disabled" | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const address = `${window.location.origin}/mcp`;

  useEffect(() => {
    listMcpGrants()
      .then(setGrants)
      .catch((e) => setGrants(e instanceof ApiError && e.code === "not_found" ? "disabled" : []));
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
      setGrants((current) =>
        Array.isArray(current) ? current.filter((g) => g.id !== id) : current,
      );
    } catch {
      setFailed(true);
    }
  };

  if (grants === undefined)
    return <p className="text-[13px] text-[var(--text-mut)]">{t("mcp.apps.loading")}</p>;
  if (grants === "disabled")
    return <p className="text-[13px] text-[var(--text-mut)]">{t("mcp.apps.disabled")}</p>;

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
              <Button variant="destructive" size="sm" onClick={() => void revoke(grant.id)}>
                {t("mcp.apps.revoke")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {failed && <p className="text-[13px] text-[var(--danger)]">{t("mcp.apps.revokeFailed")}</p>}
    </section>
  );
}
