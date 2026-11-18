import { Badge } from "@/components/ui/badge";
import { Markdown } from "@/components/ui/markdown";
import { Segmented } from "@/components/ui/segmented";
import { formatBytes } from "@/lib/aiAttachments";
import { ApiError } from "@/lib/api/client";
import {
  type SiteLinkStatus,
  type SiteModule,
  type UpdateChannel,
  getSiteLink,
  installSiteModule,
  listSiteModules,
  removeSiteLink,
  startSiteLink,
} from "@/lib/api/site";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

/** How often the page asks again while something is in progress. */
const LINK_POLL_MS = 5000;
const INSTALL_POLL_MS = 3000;

const channelKey = (serverId: string) => `artisan.updates.channel.${serverId}`;

function savedChannel(serverId: string): UpdateChannel {
  try {
    return localStorage.getItem(channelKey(serverId)) === "dev" ? "dev" : "release";
  } catch {
    return "release";
  }
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** A page of the site in the editor's language: the site keeps English at its root. */
const sitePage = (site: string, lang: string, path: string) =>
  `${site.replace(/\/$/, "")}${lang.startsWith("fr") ? "/fr" : ""}${path}`;

/** The letters of a module's tile: "Artisan Daily Rewards" → "DR". */
const initialsOf = (name: string) =>
  (name.replace(/^Artisan\s+/, "") || name)
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

const codeOf = (error: unknown) => (error instanceof ApiError ? error.code : "network_error");

/**
 * The updates tab of a server (ADR `site-account-and-module-updates`): the network's link to a
 * site account, then Artisan and its modules as the site lists them for that account, set against
 * what this server runs. An update or an install is a jar the server downloads, checks and keeps
 * for its next restart.
 */
export function ServerModulesTab({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const [link, setLink] = useState<SiteLinkStatus | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The code ran out while this page was waiting on it. */
  const [expired, setExpired] = useState(false);

  const message = useCallback(
    (code: string) =>
      t(`siteModules.errors.${code}`, { defaultValue: t("siteModules.errors.unknown") }),
    [t],
  );

  useEffect(() => {
    getSiteLink()
      .then(setLink)
      .catch(() => setLink(null));
  }, []);

  // While a code waits for approval, the hub collects the token when asked for the state.
  const waiting = link?.pending != null && !link.linked;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      getSiteLink()
        .then((next) => {
          if (!next.linked && next.pending == null) setExpired(true);
          setLink(next);
        })
        .catch(() => {});
    }, LINK_POLL_MS);
    return () => clearInterval(timer);
  }, [waiting]);

  const run = async (action: () => Promise<SiteLinkStatus>) => {
    setBusy(true);
    setError(null);
    setExpired(false);
    try {
      setLink(await action());
    } catch (e) {
      setError(message(codeOf(e)));
    } finally {
      setBusy(false);
    }
  };

  if (link === undefined)
    return <p className="text-[13px] text-[var(--text-mut)]">{t("siteModules.loading")}</p>;
  if (link === null)
    return <p className="text-[13px] text-[var(--text-mut)]">{t("siteModules.unavailable")}</p>;

  const site = hostOf(link.site);

  if (!link.linked) {
    return (
      <section className="card flex flex-col gap-4 p-5">
        {link.pending ? (
          <>
            <h2 className="text-[14px] font-semibold text-[var(--text)]">
              {t("siteModules.link.codeTitle")}
            </h2>
            <p
              className="select-all font-mono text-[28px] tracking-[0.2em] text-[var(--text)]"
              data-testid="link-code"
            >
              {link.pending.userCode}
            </p>
            <p className="text-[13px] text-[var(--text-mut)]">{t("siteModules.link.codeHelp")}</p>
            <div className="flex flex-wrap items-center gap-3">
              <a
                className="btn btn-primary btn-sm"
                href={link.pending.verificationUrl}
                target="_blank"
                rel="noreferrer"
              >
                {t("siteModules.link.open", { site })}
              </a>
              {link.canManage && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={busy}
                  onClick={() => void run(removeSiteLink)}
                >
                  {t("siteModules.link.cancel")}
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="text-[13px] text-[var(--text)]">
              {t("siteModules.link.intro", { site })}
            </p>
            {expired && (
              <p className="text-[12px] text-[var(--danger)]">{t("siteModules.link.expired")}</p>
            )}
            {link.canManage ? (
              <div>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={busy}
                  onClick={() => void run(startSiteLink)}
                >
                  {t("siteModules.link.start")}
                </button>
              </div>
            ) : (
              <p className="text-[12px] text-[var(--text-mut)]">{t("siteModules.link.noRight")}</p>
            )}
          </>
        )}
        {error && <p className="text-[12px] text-[var(--danger)]">{error}</p>}
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-[var(--text-mut)]">
          {t("siteModules.link.linked", { site, name: link.name ?? "" })}
        </p>
        {link.canManage && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy}
            onClick={() =>
              window.confirm(t("siteModules.link.unlinkConfirm")) && void run(removeSiteLink)
            }
          >
            {t("siteModules.link.unlink")}
          </button>
        )}
      </div>
      {error && <p className="text-[12px] text-[var(--danger)]">{error}</p>}
      <ModuleList
        serverId={serverId}
        site={link.site}
        canManage={link.canManage}
        message={message}
        onUnlinked={() => void getSiteLink().then(setLink)}
      />
    </div>
  );
}

function ModuleList({
  serverId,
  site,
  canManage,
  message,
  onUnlinked,
}: {
  serverId: string;
  /** The site's address: where a module's page and the catalogue are. */
  site: string;
  canManage: boolean;
  message: (code: string) => string;
  /** The site refused the token: the link is gone. */
  onUnlinked: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [channel, setChannel] = useState<UpdateChannel>(() => savedChannel(serverId));
  const [modules, setModules] = useState<SiteModule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const unlinked = useRef(onUnlinked);
  unlinked.current = onUnlinked;

  const load = useCallback(async () => {
    try {
      setModules(await listSiteModules(serverId, channel));
      setError(null);
    } catch (e) {
      const code = codeOf(e);
      if (code === "site_not_linked") unlinked.current();
      setError(message(code));
    }
  }, [serverId, channel, message]);

  useEffect(() => {
    setModules(null);
    void load();
  }, [load]);

  const downloading = modules?.some((m) => m.staged?.state === "downloading") ?? false;
  useEffect(() => {
    if (!downloading) return;
    const timer = setInterval(() => void load(), INSTALL_POLL_MS);
    return () => clearInterval(timer);
  }, [downloading, load]);

  const pick = (next: UpdateChannel) => {
    setChannel(next);
    try {
      localStorage.setItem(channelKey(serverId), next);
    } catch {
      // A private window: the choice lasts as long as the page.
    }
  };

  const install = async (module: SiteModule) => {
    setAsking(module.id);
    setError(null);
    try {
      await installSiteModule(serverId, module.id, channel);
      await load();
    } catch (e) {
      setError(message(codeOf(e)));
    } finally {
      setAsking(null);
    }
  };

  const ready = (modules ?? []).filter((m) => m.staged?.state === "ready");
  const installed = (modules ?? []).filter((m) => m.installed !== null);
  const available = (modules ?? []).filter((m) => m.installed === null);
  const nameOf = (id: string) => modules?.find((m) => m.id === id)?.name ?? id;
  /** Present, or on its way: enough to install what needs it. */
  const present = (id: string) => {
    const m = modules?.find((x) => x.id === id);
    return m !== undefined && (m.installed !== null || m.staged?.state === "ready");
  };

  const row = (module: SiteModule) => (
    <ModuleRow
      key={module.id}
      module={module}
      lang={i18n.language}
      href={sitePage(site, i18n.language, `/modules/${module.id}/`)}
      canManage={canManage}
      busy={asking === module.id}
      missing={module.requires.filter((id) => !present(id)).map(nameOf)}
      onInstall={() => void install(module)}
    />
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Segmented
          label={t("siteModules.channel.label")}
          options={[
            { value: "release", label: t("siteModules.channel.release") },
            { value: "dev", label: t("siteModules.channel.dev") },
          ]}
          value={channel}
          onChange={pick}
          className="self-start"
        />
        {channel === "dev" && (
          <p className="text-[12px] text-[var(--text-mut)]">{t("siteModules.channel.devHint")}</p>
        )}
      </div>

      {ready.length > 0 && (
        <output className="card block border-[var(--accent)] p-3 text-[13px] text-[var(--text)]">
          {t("siteModules.restart", {
            count: ready.length,
            list: ready.map((m) => `${m.name} ${m.staged?.version ?? ""}`.trim()).join(", "),
          })}
        </output>
      )}
      {error && <p className="text-[12px] text-[var(--danger)]">{error}</p>}

      {modules === null ? (
        !error && <p className="text-[13px] text-[var(--text-mut)]">{t("siteModules.loading")}</p>
      ) : modules.length === 0 ? (
        <p className="text-[13px] text-[var(--text-mut)]">{t("siteModules.empty")}</p>
      ) : (
        <>
          {installed.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="eyebrow">{t("siteModules.sections.installed")}</h2>
              {installed.map(row)}
            </section>
          )}
          {available.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="eyebrow">{t("siteModules.sections.available")}</h2>
              {available.map(row)}
            </section>
          )}
          <a
            className="self-start text-[13px] text-[var(--text-mut)] underline underline-offset-2 hover:text-[var(--text)]"
            href={sitePage(site, i18n.language, "/modules/")}
            target="_blank"
            rel="noreferrer"
          >
            {t("siteModules.catalogue", { site: hostOf(site) })}
          </a>
        </>
      )}
    </div>
  );
}

function formatPrice(price: { amount: number; currency: string }, lang: string): string {
  try {
    return new Intl.NumberFormat(lang, {
      style: "currency",
      currency: price.currency.toUpperCase(),
    }).format(price.amount / 100);
  } catch {
    return `${(price.amount / 100).toFixed(2)} ${price.currency.toUpperCase()}`;
  }
}

function ModuleRow({
  module,
  lang,
  href,
  canManage,
  busy,
  missing,
  onInstall,
}: {
  module: SiteModule;
  lang: string;
  /** Its page on the site: what it does, with screenshots, and where it is bought. */
  href: string;
  canManage: boolean;
  busy: boolean;
  /** Names of the modules it needs that this server does not have. */
  missing: string[];
  onInstall: () => void;
}) {
  const { t } = useTranslation();
  const { latest, staged } = module;
  const tagline = module.tagline
    ? (lang.startsWith("fr") && module.tagline.fr) || module.tagline.en
    : "";
  const isInstalled = module.installed !== null;
  // Something to fetch: a newer version, or a module this server does not run yet.
  const offered = latest !== null && (isInstalled ? module.update : true);
  // What is already waiting for the restart is not offered again.
  const stagedLatest = staged?.state === "ready" && staged.version === latest?.version;
  const downloading = staged?.state === "downloading";

  return (
    <article className="card flex flex-col gap-3 p-4" data-testid={`module-${module.id}`}>
      <div className="flex flex-wrap items-start gap-3 sm:flex-nowrap">
        <span
          aria-hidden="true"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border border-[var(--brand-line)] bg-[var(--brand-soft)] text-[13px] font-bold text-[var(--brand)]"
        >
          {initialsOf(module.name)}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[14px] font-semibold text-[var(--text)]">
              <a className="hover:underline" href={href} target="_blank" rel="noreferrer">
                {module.name}
              </a>
            </h3>
            {isInstalled &&
              (module.update ? (
                <Badge variant="amber">
                  {t("siteModules.row.latest", { version: latest?.version })}
                </Badge>
              ) : (
                <Badge variant="sage">{t("siteModules.row.upToDate")}</Badge>
              ))}
            {module.access === "licence" && (
              <Badge variant="terra">{t("siteModules.row.licence")}</Badge>
            )}
            {module.access === "supporter" && (
              <Badge variant="terra">{t("siteModules.row.supporter")}</Badge>
            )}
          </div>
          {tagline && <p className="text-[13px] text-[var(--text-mut)]">{tagline}</p>}
          <p className="text-[12px] text-[var(--text-faint)]">
            {[
              isInstalled
                ? t("siteModules.row.installed", { version: module.installed })
                : latest
                  ? t("siteModules.row.latest", { version: latest.version })
                  : t("siteModules.row.none"),
              !isInstalled &&
                (module.price ? formatPrice(module.price, lang) : t("siteModules.row.free")),
              offered && latest ? formatBytes(latest.size) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {module.access !== "ok"
            ? (module.access === "licence" || module.page) && (
                <a
                  className="btn btn-ghost btn-sm"
                  // A module to buy: its own page, which presents it; the plan: the site's `page`.
                  href={module.access === "licence" ? href : (module.page ?? href)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t(
                    module.access === "supporter" ? "siteModules.row.plan" : "siteModules.row.buy",
                  )}
                </a>
              )
            : canManage &&
              offered &&
              latest &&
              !stagedLatest &&
              !downloading && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={busy || missing.length > 0}
                  onClick={onInstall}
                >
                  {staged?.state === "failed"
                    ? t("siteModules.row.retry")
                    : isInstalled
                      ? t("siteModules.row.update", { version: latest.version })
                      : t("siteModules.row.install", { version: latest.version })}
                </button>
              )}
        </div>
      </div>

      {missing.length > 0 && !isInstalled && module.access === "ok" && (
        <p className="text-[12px] text-[var(--text-mut)]">
          {t("siteModules.row.requires", { list: missing.join(", ") })}
        </p>
      )}
      {staged && (
        <p
          className={
            staged.state === "failed"
              ? "text-[12px] text-[var(--danger)]"
              : "text-[12px] text-[var(--text-mut)]"
          }
        >
          {staged.state === "failed"
            ? t("siteModules.row.failed", {
                version: staged.version,
                reason: t(`siteModules.failures.${staged.error ?? "unknown"}`, {
                  defaultValue: t("siteModules.failures.unknown"),
                }),
              })
            : t(`siteModules.row.${staged.state}`, { version: staged.version })}
        </p>
      )}
      {offered && latest && (
        <details className="text-[13px]">
          <summary className="cursor-pointer text-[12px] text-[var(--text-mut)]">
            {t("siteModules.row.changelog", { version: latest.version })}
          </summary>
          <div className="mt-2">
            {latest.changelog.trim() ? (
              <Markdown>{latest.changelog}</Markdown>
            ) : (
              <p className="text-[12px] text-[var(--text-faint)]">
                {t("siteModules.row.noChangelog")}
              </p>
            )}
          </div>
        </details>
      )}
    </article>
  );
}
