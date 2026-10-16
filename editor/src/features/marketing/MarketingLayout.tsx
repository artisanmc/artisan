import { Button } from "@/components/ui/button";
import { setSiteLang } from "@/site/i18n";
import { ChevronDown, Menu, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import "./marketing.css";

export const INSTALL_URL = "/wiki/getting-started/install-admin/";

export function MarketingLayout({
  children,
  description,
}: { children: ReactNode; description: string }) {
  const { t, i18n } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    document.title = t("marketing.nav.homeTitle");
  }, [t]);

  return (
    <div className="marketing">
      <meta name="description" content={description} />
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
            <a href="/wiki/">{t("marketing.nav.wiki")}</a>
          </nav>
          <div className="marketing-nav-actions">
            <label className="marketing-language">
              <span className="sr-only">{t("marketing.nav.language")}</span>
              <select
                value={i18n.language.startsWith("fr") ? "fr" : "en"}
                onChange={(e) => setSiteLang(e.target.value as "en" | "fr")}
              >
                <option value="en">EN</option>
                <option value="fr">FR</option>
              </select>
              <ChevronDown size={12} />
            </label>
            <Button asChild variant="primary" className="marketing-nav-cta">
              <a href={INSTALL_URL}>{t("marketing.nav.start")}</a>
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
            <a href="/wiki/">{t("marketing.nav.wiki")}</a>
            <a href={INSTALL_URL}>{t("marketing.nav.start")}</a>
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
            <a href="/#editor">{t("marketing.nav.product")}</a>
            <a href={INSTALL_URL}>{t("marketing.nav.start")}</a>
          </div>
          <div>
            <h2>{t("marketing.footer.resources")}</h2>
            <a href="/wiki/">{t("marketing.nav.wiki")}</a>
            <a href={INSTALL_URL}>{t("marketing.footer.install")}</a>
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
