import { Button } from "@/components/ui/button";
import {
  BookOpen,
  Check,
  ChevronDown,
  Command,
  Layers,
  MousePointer2,
  Paintbrush,
  Send,
  Sparkles,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { MarketingLayout } from "./MarketingLayout";
import { PixelItem } from "./PixelItem";
import { landingEn, landingFr } from "./landingCopy";
import "./landing.css";

const featureIcons = [MousePointer2, Command, Sparkles];
const workflowIcons = [Paintbrush, Layers, Send];

export function LandingPage() {
  const { i18n } = useTranslation();
  const language = i18n.language.startsWith("fr") ? "fr" : "en";
  const copy = language === "fr" ? landingFr : landingEn;

  return (
    <MarketingLayout page="home" description={copy.intro}>
      <section className="landing-hero marketing-container" aria-labelledby="landing-title">
        <div className="landing-category">
          <span className="landing-category-mark">
            <PixelItem name="diamond" />
          </span>
          {copy.category}
        </div>
        <h1 id="landing-title">
          {copy.title[0]}
          <br />
          {copy.title[1]}
        </h1>
        <p className="landing-hero-intro">{copy.intro}</p>
        <div className="landing-actions">
          <Button asChild variant="primary" size="lg">
            <a href="/demo" target="_blank" rel="noopener noreferrer">
              {copy.demo}
              <MousePointer2 size={16} aria-hidden="true" />
            </a>
          </Button>
          <Button asChild variant="outline" size="lg">
            <a href="/pricing">{copy.pricing}</a>
          </Button>
        </div>
        <p className="landing-demo-note">{copy.demoNote}</p>
        <div className="landing-pillars">
          {copy.pillars.map((pillar) => (
            <span key={pillar}>
              <Check size={15} aria-hidden="true" />
              {pillar}
            </span>
          ))}
        </div>
      </section>

      <section
        id="editor"
        className="landing-features marketing-container"
        aria-labelledby="landing-features-title"
      >
        <div className="landing-section-lead">
          <h2 id="landing-features-title">{copy.featuresTitle}</h2>
          <p>{copy.featuresIntro}</p>
        </div>
        <div className="landing-feature-list">
          {copy.features.map((feature, index) => {
            const Icon = featureIcons[index] ?? MousePointer2;
            return (
              <article key={feature.title} className="landing-feature">
                <div className="landing-feature-icon">
                  <Icon size={20} strokeWidth={1.7} aria-hidden="true" />
                </div>
                <div>
                  <h3>{feature.title}</h3>
                  <p>{feature.description}</p>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section
        className="landing-creativity marketing-container"
        aria-labelledby="landing-creativity-title"
      >
        <div className="landing-creative-art" aria-hidden="true">
          <div className="landing-creative-grid">
            {(
              [
                "diamondSword",
                "compass",
                "emerald",
                "book",
                "enderPearl",
                "diamondPickaxe",
                "goldenApple",
                "map",
                "diamond",
              ] as const
            ).map((item, index) => (
              <div key={item} className={`landing-creative-pixel pixel-${index}`}>
                <PixelItem name={item} />
              </div>
            ))}
          </div>
          <div className="landing-creative-label">
            <Layers size={15} />
            {language === "fr" ? "Objets · Textures · Titres" : "Items · Textures · Titles"}
          </div>
        </div>
        <div className="landing-creative-copy">
          <h2 id="landing-creativity-title">{copy.creativeTitle}</h2>
          <p>{copy.creativeText}</p>
          <a className="landing-text-link" href="/wiki/editor/composed-titles/">
            {copy.creativeLink}
            <BookOpen size={16} aria-hidden="true" />
          </a>
        </div>
      </section>

      <section
        className="landing-workflow marketing-container"
        aria-labelledby="landing-workflow-title"
      >
        <div className="landing-workflow-lead">
          <h2 id="landing-workflow-title">{copy.workflowTitle}</h2>
          <p>{copy.workflowIntro}</p>
        </div>
        <ol className="landing-workflow-steps">
          {copy.workflow.map((step, index) => {
            const Icon = workflowIcons[index] ?? Paintbrush;
            return (
              <li key={step.title}>
                <div className="landing-step-track">
                  <span className="landing-step-number">{index + 1}</span>
                  <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
                </div>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </li>
            );
          })}
        </ol>
        <a className="landing-text-link" href="/wiki/getting-started/install-admin/">
          {copy.install}
          <BookOpen size={16} aria-hidden="true" />
        </a>
      </section>

      <section className="landing-wiki marketing-container" aria-labelledby="landing-wiki-title">
        <div className="landing-wiki-icon">
          <BookOpen size={28} strokeWidth={1.5} aria-hidden="true" />
        </div>
        <div>
          <h2 id="landing-wiki-title">{copy.wikiTitle}</h2>
          <p>{copy.wikiText}</p>
        </div>
        <Button asChild variant="outline" size="lg">
          <a href="/wiki/">{copy.wiki}</a>
        </Button>
      </section>

      <section className="landing-faq marketing-container" aria-labelledby="landing-faq-title">
        <h2 id="landing-faq-title">{copy.faqTitle}</h2>
        <div className="landing-faq-list">
          {copy.faq.map((faq) => (
            <details key={faq.question}>
              <summary>
                {faq.question}
                <ChevronDown size={18} aria-hidden="true" />
              </summary>
              <p>{faq.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section
        className="landing-closing marketing-container"
        aria-labelledby="landing-closing-title"
      >
        <PixelItem name="diamondPickaxe" />
        <h2 id="landing-closing-title">{copy.closingTitle}</h2>
        <p>{copy.closingText}</p>
        <div className="landing-actions">
          <Button asChild variant="primary" size="lg">
            <a href="/demo" target="_blank" rel="noopener noreferrer">
              {copy.demo}
              <MousePointer2 size={16} aria-hidden="true" />
            </a>
          </Button>
          <Button asChild variant="outline" size="lg">
            <a href="/signup">{copy.signup}</a>
          </Button>
        </div>
      </section>
    </MarketingLayout>
  );
}
