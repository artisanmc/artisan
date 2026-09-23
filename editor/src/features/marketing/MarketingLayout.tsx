import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/state/authStore";
import { useUiStore } from "@/state/uiStore";
import { ChevronDown, Menu, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import "./marketing.css";

export function MarketingLayout({
  children,
  page = "home",
  description,
}: { children: ReactNode; page?: "home" | "pricing"; description?: string }) {
  const { t, i18n } = useTranslation();
  const user = useAuthStore((s) => s.currentUser);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    const old = document.title;
    document.title =
      page === "pricing" ? `${t("marketing.nav.pricing")} · Artisan` : t("marketing.nav.homeTitle");
    return () => {
      document.title = old;
    };
  }, [page, t]);

  return (
    <div className="marketing">
      <meta name="description" content={description ?? t("marketing.pricing.intro")} />
      <a className="marketing-skip" href="#main-content">
        {i18n.language.startsWith("fr") ? "Aller au contenu" : "Skip to content"}
      </a>
      <header className="marketing-header">
        <div className="marketing-container marketing-nav">
          <a className="marketing-logo" href="/" aria-label="Artisan">
            <img src="/logo.svg" alt="" width="34" height="34" />
            <span>Artisan</span>
          </a>
          <nav className="marketing-desktop-nav" aria-label={t("marketing.nav.menu")}>
            <a href="/#editor">{t("marketing.nav.product")}</a>
            <a href="/pricing" aria-current={page === "pricing" ? "page" : undefined}>
              {t("marketing.nav.pricing")}
            </a>
            <a href="/wiki/">{t("marketing.nav.wiki")}</a>
          </nav>
          <div className="marketing-nav-actions">
            <label className="marketing-language">
              <span className="sr-only">{t("marketing.nav.language")}</span>
              <select
                value={i18n.language.startsWith("fr") ? "fr" : "en"}
                onChange={(e) => useUiStore.getState().setEditorLang(e.target.value as "en" | "fr")}
              >
                <option value="en">EN</option>
                <option value="fr">FR</option>
              </select>
              <ChevronDown size={12} />
            </label>
            {!user && (
              <a className="marketing-login" href="/login">
                {t("marketing.nav.login")}
              </a>
            )}
            <Button asChild variant="primary" className="marketing-nav-cta">
              <a href={user ? "/networks" : "/signup"}>
                {t(user ? "marketing.nav.workspace" : "marketing.nav.start")}
              </a>
            </Button>
            <Button
              className="marketing-mobile-toggle"
              size="icon"
              variant="ghost"
              aria-label={t("marketing.nav.menu")}
              aria-expanded={menuOpen}
              aria-controls="marketing-mobile-nav"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              {menuOpen ? <X size={21} /> : <Menu size={21} />}
            </Button>
          </div>
        </div>
        {menuOpen && (
          <nav
            id="marketing-mobile-nav"
            className="marketing-mobile-nav"
            aria-label={t("marketing.nav.menu")}
          >
            {/* biome-ignore lint/a11y/useValidAnchor: This is an actual section link; close navigation after following it. */}
            <a href="/#editor" onClick={() => setMenuOpen(false)}>
              {t("marketing.nav.product")}
            </a>
            <a href="/pricing">{t("marketing.nav.pricing")}</a>
            <a href="/wiki/">{t("marketing.nav.wiki")}</a>
            <a href={user ? "/networks" : "/login"}>
              {t(user ? "marketing.nav.workspace" : "marketing.nav.login")}
            </a>
          </nav>
        )}
      </header>
      <div id="main-content">{children}</div>
      <footer className="marketing-footer marketing-container">
        <div className="marketing-footer-top">
          <div>
            <a className="marketing-logo" href="/">
              <img src="/logo.svg" alt="" width="32" height="32" />
              <span>Artisan</span>
            </a>
            <p>{t("marketing.footer.tagline")}</p>
          </div>
          <div>
            <h2>{t("marketing.footer.product")}</h2>
            <a href="/demo" target="_blank" rel="noopener noreferrer">
              {t("marketing.footer.demo")}
            </a>
            <a href="/pricing">{t("marketing.nav.pricing")}</a>
            <a href={user ? "/networks" : "/signup"}>{t("marketing.nav.start")}</a>
          </div>
          <div>
            <h2>{t("marketing.footer.resources")}</h2>
            <a href="/wiki/">{t("marketing.nav.wiki")}</a>
            <a href="/wiki/getting-started/install-admin/">{t("marketing.footer.install")}</a>
            <a href="/wiki/editor/credits/">{t("marketing.footer.credits")}</a>
          </div>
          <div>
            <h2>{t("marketing.footer.legal")}</h2>
            <a href="/terms.html">{t("marketing.footer.terms")}</a>
            <a href="/privacy.html">{t("marketing.footer.privacy")}</a>
            <a href="/about.html">{t("marketing.footer.about")}</a>
          </div>
        </div>
        <div className="marketing-footer-bottom">
          <span>© {new Date().getFullYear()} Artisan</span>
          <span>{t("marketing.footer.independent")}</span>
        </div>
      </footer>
    </div>
  );
}
