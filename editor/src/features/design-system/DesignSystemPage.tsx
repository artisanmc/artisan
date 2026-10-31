import { SplitPane } from "@/components/SplitPane";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import {
  McActionBar,
  McChat,
  McMotd,
  McScreen,
  McScreenControls,
  type McScreenSettings,
  McTitle,
  McTooltip,
} from "@/components/mc-preview";
import { MmTextField } from "@/components/minimessage";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbCurrent,
  BreadcrumbSwitcher,
  breadcrumbLinkClass,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChangeList } from "@/components/ui/change-list";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible } from "@/components/ui/collapsible";
import { DataTable } from "@/components/ui/data-table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSearch,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  matchesMenuSearch,
} from "@/components/ui/dropdown-menu";
import { EditorHeader } from "@/components/ui/editor-header";
import { EmptyState } from "@/components/ui/empty-state";
import { FileDiff } from "@/components/ui/file-diff";
import { FileDropzone } from "@/components/ui/file-dropzone";
import { SaveFilledIcon } from "@/components/ui/filled-icons";
import { FormField } from "@/components/ui/form-field";
import { GuidedTour } from "@/components/ui/guided-tour";
import { HBar } from "@/components/ui/h-bar";
import { IconTile } from "@/components/ui/icon-tile";
import { Input } from "@/components/ui/input";
import { LocalizedField } from "@/components/ui/localized-field";
import { Markdown } from "@/components/ui/markdown";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ProBadge } from "@/components/ui/pro-badge";
import { ResetButton } from "@/components/ui/reset-button";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { Segmented } from "@/components/ui/segmented";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { SortableList } from "@/components/ui/sortable-list";
import { Spinner } from "@/components/ui/spinner";
import { StatCard } from "@/components/ui/stat-card";
import { Switch } from "@/components/ui/switch";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TagInput } from "@/components/ui/tag-input";
import { Tooltip } from "@/components/ui/tooltip";
import { WorkspaceView } from "@/components/ui/workspace-view";
import { YamlCodeEditor } from "@/components/ui/yaml-code-editor";
import { CanvasToolbar } from "@/features/canvas/CanvasToolbar";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { ACTION_FAMILIES, actionAppearance, familyColors } from "@/lib/actions/actionFamily";
import { LORE } from "@/lib/mm/profiles";
import type { PlaceholderEntry } from "@/lib/placeholderCatalog";
import { useUiStore } from "@/state/uiStore";
import { Inbox, LayoutGrid, Pencil, Plus, Search, Sparkles, TerminalSquare } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Living style guide rendered at /design. Every token, utility class
 * and ui/ primitive of the editor is shown live here — when adding a new
 * component or token, add its specimen to this page in the same commit.
 *
 * Specimen labels (token names, class names, variant names) are code
 * identifiers, intentionally NOT translated; page chrome goes through i18n.
 */

const COLOR_GROUPS: { key: string; tokens: string[] }[] = [
  {
    key: "surfaces",
    tokens: [
      "--surface",
      "--surface-raised",
      "--surface-raised-2",
      "--surface-inset",
      "--surface-hover",
    ],
  },
  { key: "text", tokens: ["--text", "--text-mut", "--text-faint", "--text-on-accent"] },
  { key: "borders", tokens: ["--border-soft", "--border", "--border-strong"] },
  {
    key: "brand",
    tokens: ["--brand", "--brand-hover", "--brand-fg", "--brand-soft", "--brand-line"],
  },
  {
    key: "status",
    tokens: [
      "--success",
      "--success-soft",
      "--warning",
      "--warning-soft",
      "--danger",
      "--danger-soft",
    ],
  },
  {
    key: "kinds",
    tokens: [
      ...["menu", "command", "dialog", "trigger", "module"].flatMap((k) => [
        `--kind-${k}`,
        `--kind-${k}-soft`,
        `--kind-${k}-line`,
      ]),
      ...ACTION_FAMILIES.flatMap((f) => [`--fam-${f}`, `--fam-${f}-soft`]),
      "--fam-logic-line",
      "--mc-chat-bg",
    ],
  },
];

/** One action per family, for the IconTile specimen. */
const SPECIMEN_ACTIONS = [
  ["send_message", "message"],
  ["play_sound", "effect"],
  ["open_menu", "navigation"],
  ["give_money", "reward"],
  ["teleport", "world"],
  ["set_arg", "logic"],
  ["quests:start", "module"],
] as const;

const RADII = ["--r-xs", "--r-sm", "--r-md", "--r-lg", "--r-xl", "--r-pill"];
const SHADOWS = ["--shadow-sm", "--shadow-md", "--shadow-lg"];

const BUTTON_VARIANTS = ["default", "primary", "destructive", "outline", "ghost"] as const;
const BTN_CLASSES = [
  "btn",
  "btn btn-primary",
  "btn btn-outline",
  "btn btn-ghost",
  "btn btn-danger",
  "btn btn-discord",
];
const SAMPLE_YAML = `# Shop settings — managed by Artisan
# Discount applied to the whole shop (0 to 100).
whole_shop_discount: 10
placeholders:
  # Available placeholder: %price%.
  price_display: "%price% tokens"
`;

const BADGE_VARIANTS = ["amber", "sage", "terra", "brick"] as const;
const BADGE_CLASSES = ["badge-amber", "badge-sage", "badge-terra", "badge-brick"];

const SAMPLE_LORE =
  "<gray>Forged in <gradient:#ff3d00:#ffb300>dragon fire</gradient>.\n<gold>★★★★☆</gold>";

// A guild member's card: the case of the "computed text" pill.
const SAMPLE_MEMBER_LORE = [
  "<gray>Grade : <red>{m.rank}",
  '{m.online ? "<green>En ligne" : "<gray>Hors ligne"}',
  "",
  '{m.can_promote ? "<yellow>Clic gauche : promouvoir" : ""}',
  '{m.can_demote ? "<yellow>Clic droit : rétrograder" : ""}',
  '{m.can_kick ? "<red>Shift + clic droit : exclure" : ""}',
  "<gray>Membre depuis {m.joined.ago()}",
].join("\n");

const SAMPLE_MEMBER: PlaceholderEntry[] = [
  { path: "m.rank", type: "string", sample: "Officier", origin: "iteration" },
  { path: "m.online", type: "boolean", sample: "true", origin: "iteration" },
  { path: "m.can_promote", type: "boolean", sample: "true", origin: "iteration" },
  { path: "m.can_demote", type: "boolean", sample: "false", origin: "iteration" },
  { path: "m.can_kick", type: "boolean", sample: "true", origin: "iteration" },
  { path: "m.joined.ago()", type: "string", sample: "40 j", origin: "iteration" },
];

function McScreenSpecimen() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<McScreenSettings>({
    width: 1920,
    height: 1080,
    guiScale: "auto",
    zoom: "fit",
  });
  return (
    <div className="flex flex-col gap-2">
      <span className="mono text-[11px] text-[var(--text-faint)]">
        {"<McScreen> <McScreenControls>"}
      </span>
      <p className="text-[11px] text-[var(--text-faint)]">{t("adminDesign.mcScreenHint")}</p>
      <McScreenControls value={settings} onChange={setSettings} />
      <div className="max-h-[520px] overflow-auto">
        <McScreen
          {...settings}
          hotbar={{ selected: 2 }}
          survival={{ health: 17, food: 20, xp: 0.4, level: 12 }}
          bossBars={[{ name: "<light_purple>Dragon", progress: 0.6 }]}
          title={{ title: "<gold><bold>Victory", subtitle: "<gray>Round 3" }}
          actionBar="<green>+25 coins"
          chat={[
            "<yellow>Steve joined the game",
            "<gray>[<gold>Guide</gold>]</gray> Welcome to the server! Type <aqua>/menu</aqua> to start.",
          ]}
          chatInput="/menu"
        />
      </div>
    </div>
  );
}

function MiniMessageSpecimens() {
  const { t } = useTranslation();
  const [lore, setLore] = useState(SAMPLE_LORE);
  const [member, setMember] = useState(SAMPLE_MEMBER_LORE);
  const [color, setColor] = useState("#5ab4ff");
  return (
    <div className="card flex flex-col gap-6 p-5">
      <div className="flex flex-col gap-2">
        <span className="mono text-[11px] text-[var(--text-faint)]">
          {'<MmTextField profile={LORE} layout="column">'}
        </span>
        <p className="text-[11px] text-[var(--text-faint)]">{t("adminDesign.mmEditorHint")}</p>
        <MmTextField value={lore} onChange={setLore} profile={LORE} layout="column" />
      </div>
      <div className="flex flex-col gap-2">
        <span className="mono text-[11px] text-[var(--text-faint)]">
          {'<MmTextField profile={LORE} entries={…} layout="column">'}
        </span>
        <p className="text-[11px] text-[var(--text-faint)]">{t("adminDesign.mmExprHint")}</p>
        <MmTextField
          value={member}
          onChange={setMember}
          profile={LORE}
          entries={SAMPLE_MEMBER}
          layout="column"
        />
      </div>
      <div className="flex flex-col gap-2">
        <span className="mono text-[11px] text-[var(--text-faint)]">
          {"<McChat> <McTooltip> <McMotd> <McActionBar> <McTitle>"}
        </span>
        <p className="text-[11px] text-[var(--text-faint)]">{t("adminDesign.mcPreviewHint")}</p>
        <div className="flex flex-wrap items-start gap-4">
          <McChat messages={["<green>Ready</green> <gray>— 3 players online"]} />
          <McTooltip
            title="<aqua>Diamond Sword"
            enchants={["Sharpness V"]}
            lore={["<gray>Sharp."]}
          />
          <McMotd motd={"<gold>Artisan</gold> <gray>1.21\n<yellow>Open!"} />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <McActionBar text="<green>+25 coins" />
          <McTitle title="<gold><bold>Victory" subtitle="<gray>Round 3" />
        </div>
      </div>
      <McScreenSpecimen />
      <div className="flex flex-col gap-2">
        <span className="mono text-[11px] text-[var(--text-faint)]">{"<Popover>"}</span>
        <p className="text-[11px] text-[var(--text-faint)]">{t("adminDesign.popoverHint")}</p>
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="btn btn-outline btn-sm self-start">
              {color}
            </button>
          </PopoverTrigger>
          <PopoverContent>
            <input className="input" value={color} onChange={(e) => setColor(e.target.value)} />
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

function LocalizedFieldSpecimen({ inline }: { inline?: boolean }) {
  const [values, setValues] = useState<Record<string, string | undefined>>({
    en: "Back",
    fr: "Retour",
  });
  return (
    <LocalizedField
      className="max-w-xs"
      inline={inline}
      label="Title"
      langs={["en", "fr", "de"]}
      activeLang="en"
      defaultLang="en"
      values={values}
      onChange={(lang, value) => setValues((v) => ({ ...v, [lang]: value }))}
      renderEditor={({ value, fallback, label, onChange }) => (
        <Input
          aria-label={label}
          value={value}
          placeholder={fallback}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    />
  );
}

function Section({
  id,
  title,
  children,
}: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section data-testid={`ds-section-${id}`} className="flex flex-col gap-4">
      <h2 className="eyebrow">{title}</h2>
      {children}
    </section>
  );
}

function Swatch({ token }: { token: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="size-9 shrink-0 rounded-[var(--r-sm)] border border-[var(--border-soft)]"
        style={{ background: `var(${token})` }}
      />
      <span className="mono text-[11.5px] text-[var(--text-mut)]">{token}</span>
    </div>
  );
}

export function DesignSystemPage() {
  const { t } = useTranslation();
  const [splitSize, setSplitSize] = useState(160);
  const [tourOpen, setTourOpen] = useState(false);
  const [segValue, setSegValue] = useState<"chest" | "hopper" | "dropper">("chest");
  const tourTarget = useRef<HTMLButtonElement>(null);

  return (
    <div className="flex flex-col gap-10">
      <Section id="guided-tour" title="GuidedTour">
        <Button ref={tourTarget} onClick={() => setTourOpen(true)}>
          {t("onboarding.discover")}
        </Button>
        <GuidedTour
          open={tourOpen}
          target={tourTarget.current}
          step={1}
          totalSteps={6}
          title={t("onboarding.navigationTitle")}
          description={t("onboarding.navigationDescription")}
          labels={{
            next: t("onboarding.finish"),
            previous: t("onboarding.previous"),
            defer: t("onboarding.defer"),
            progress: t("onboarding.progress", { step: 1, total: 6 }),
          }}
          onNext={() => setTourOpen(false)}
          onDefer={() => setTourOpen(false)}
        />
      </Section>
      <Section id="breadcrumb" title="Breadcrumb">
        <Breadcrumb label={t("breadcrumb.label")}>
          <a href="#breadcrumb" className={breadcrumbLinkClass}>
            Primalcraft
          </a>
          <BreadcrumbSwitcher
            current="survival"
            items={[
              { id: "lobby", label: "Lobby" },
              { id: "survival", label: "Survival" },
              { id: "creative", label: "Creative" },
            ]}
            onSelect={() => {}}
            searchPlaceholder={t("breadcrumb.searchServers")}
          />
          <BreadcrumbCurrent>main</BreadcrumbCurrent>
        </Breadcrumb>
      </Section>
      <Section id="file-diff" title={t("save.diffLabel")}>
        <FileDiff
          before={"name: Shop\nprice: 10\nenabled: true\n"}
          after={"name: Shop\nprice: 20\nenabled: true\n"}
        />
      </Section>
      <Section id="tooltip" title={t("drafts.save")}>
        <div className="flex items-center gap-3">
          <Tooltip content={t("drafts.tooltip.pending")}>
            <button
              type="button"
              aria-label={t("drafts.save")}
              className="btn btn-sm btn-ghost btn-icon"
            >
              <SaveFilledIcon aria-hidden />
            </button>
          </Tooltip>
          <Tooltip content={t("drafts.tooltip.saved")} side="top">
            <button type="button" className="btn btn-sm btn-ghost">
              {t("drafts.savedShort")}
            </button>
          </Tooltip>
        </div>
      </Section>
      <Section id="change-list" title={t("drafts.changes")}>
        <ChangeList
          before={{
            "menus/shop.yaml": "title: Shop\nsize: 27\nprice: 10\n",
            "menus/old.yaml": "title: Old\n",
          }}
          after={{
            "menus/shop.yaml": "title: Shop\nsize: 27\nprice: 20\n",
            "menus/new.yaml": "title: Old\n",
            "lang/en.yaml": "shop.title: Shop\n",
          }}
          renames={[{ from: "menus/old.yaml", to: "menus/new.yaml" }]}
          problems={{ "menus/shop.yaml": ["schema: price is not allowed"] }}
        />
      </Section>
      <Section id="markdown" title="Markdown">
        <div className="card max-w-xl p-4">
          <Markdown>
            {
              "The **auctions** project has 4 menus:\n\n| id | file |\n|---|---|\n| `ah_main` | `menus/ah_main.yml` |\n| `ah_lot` | `menus/ah_lot.yml` |\n\n- one command, `ah`\n- 7 dialogs\n\n```yaml\ntitle: Auction house\nsize: 54\n```"
            }
          </Markdown>
        </div>
      </Section>
      <Section id="resize-handle" title="ResizeHandle">
        <ResizeHandleSpecimen />
      </Section>
      {/* Rules */}
      <Section id="guidelines" title={t("adminDesign.guidelines.heading")}>
        <div className="card p-5">
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[13px] text-[var(--text-mut)]">
            {(["rule1", "rule2", "rule3", "rule4", "rule5"] as const).map((k) => (
              <li key={k}>{t(`adminDesign.guidelines.${k}`)}</li>
            ))}
          </ul>
        </div>
      </Section>

      {/* Color tokens */}
      <Section id="colors" title={t("adminDesign.sections.colors")}>
        <div className="flex items-center gap-3">
          <span className="text-[13px] text-[var(--text-mut)]">{t("adminDesign.themeHint")}</span>
          <ThemeSwitcher />
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {COLOR_GROUPS.map((group) => (
            <div key={group.key} className="card flex flex-col gap-3 p-5">
              <span className="text-[12px] font-semibold text-[var(--text)]">
                {t(`adminDesign.groups.${group.key}`)}
              </span>
              {group.tokens.map((token) => (
                <Swatch key={token} token={token} />
              ))}
            </div>
          ))}
        </div>
      </Section>

      {/* Typography */}
      <Section id="typography" title={t("adminDesign.sections.typography")}>
        <div className="card flex flex-col gap-5 p-5">
          <div className="flex flex-col gap-1">
            <span className="mono text-[11px] text-[var(--text-faint)]">
              .display / --font-display · Inter Bold 700 · Bunny Fonts
            </span>
            <span className="display text-[28px] text-[var(--text)]">
              Artisan — Menus & Projects
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="mono text-[11px] text-[var(--text-faint)]">--font-body</span>
            <span className="text-[13.5px] text-[var(--text)]">{t("adminDesign.bodySample")}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="mono text-[11px] text-[var(--text-faint)]">.mono / --font-mono</span>
            <span className="mono text-[12.5px] text-[var(--text)]">
              project_id · menu.yaml · %player_name%
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="mono text-[11px] text-[var(--text-faint)]">.eyebrow</span>
            <span className="eyebrow">Section label</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="mono text-[11px] text-[var(--text-faint)]">.field-label</span>
            <span className="field-label">Field label</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="mono text-[11px] text-[var(--text-faint)]">.section-label</span>
            <span className="section-label">Section label</span>
          </div>
        </div>
      </Section>

      {/* Radii & shadows */}
      <Section id="radii-shadows" title={t("adminDesign.sections.radiiShadows")}>
        <div className="card flex flex-col gap-6 p-5">
          <div className="flex flex-wrap items-end gap-5">
            {RADII.map((token) => (
              <div key={token} className="flex flex-col items-center gap-2">
                <span
                  className="size-14 border border-[var(--border)] bg-[var(--surface-raised-2)]"
                  style={{ borderRadius: `var(${token})` }}
                />
                <span className="mono text-[10.5px] text-[var(--text-faint)]">{token}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-8">
            {SHADOWS.map((token) => (
              <div key={token} className="flex flex-col items-center gap-2">
                <span
                  className="size-14 rounded-[var(--r-md)] bg-[var(--surface-raised)]"
                  style={{ boxShadow: `var(${token})` }}
                />
                <span className="mono text-[10.5px] text-[var(--text-faint)]">{token}</span>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* CSS utility classes */}
      <Section id="css-utilities" title={t("adminDesign.sections.cssUtilities")}>
        <div className="card flex flex-col gap-6 p-5">
          <div className="flex flex-wrap items-center gap-3">
            {BTN_CLASSES.map((cls) => (
              <button key={cls} type="button" className={cls}>
                {cls.replace("btn ", "")}
              </button>
            ))}
            <button type="button" className="btn btn-sm">
              btn-sm
            </button>
            <button type="button" className="btn btn-icon" aria-label="btn-icon">
              <Plus className="size-[16px]" />
            </button>
          </div>
          <div className="grid max-w-xl grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col">
              <span className="field-label">.input</span>
              <input className="input" placeholder="Placeholder" />
            </label>
            <label className="flex flex-col">
              <span className="field-label">.select</span>
              <select className="select">
                <option>Option A</option>
                <option>Option B</option>
              </select>
            </label>
            <label className="flex flex-col sm:col-span-2">
              <span className="field-label">.textarea</span>
              <textarea className="textarea" placeholder="Multiline…" />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="chip">.chip</span>
            <span className="chip is-active">.chip.is-active</span>
            <span className="checker flex h-7 w-16 items-center justify-center rounded-[var(--r-sm)] text-[11px]">
              .checker
            </span>
            <span className="hatch flex h-7 w-16 items-center justify-center rounded-[var(--r-sm)] text-[11px]">
              .hatch
            </span>
            {BADGE_CLASSES.map((cls) => (
              <span key={cls} className={`badge ${cls}`}>
                {cls}
              </span>
            ))}
            <span className="flex items-center gap-1.5 text-[12px] text-[var(--text-mut)]">
              <span className="dot" style={{ background: "var(--success)" }} /> .dot
            </span>
          </div>
          <hr className="rule" />
          <div className="tabstrip">
            <button type="button" className="tab is-active">
              .tab.is-active
            </button>
            <button type="button" className="tab">
              .tab
            </button>
          </div>
        </div>
      </Section>

      {/* React primitives (components/ui) */}
      <Section id="primitives" title={t("adminDesign.sections.primitives")}>
        <div className="card flex flex-col gap-6 p-5">
          <div className="flex flex-col gap-2">
            <span className="mono text-[11px] text-[var(--text-faint)]">
              {"<Button variant size>"}
            </span>
            <div className="flex flex-wrap items-center gap-3">
              {BUTTON_VARIANTS.map((variant) => (
                <Button key={variant} variant={variant}>
                  {variant}
                </Button>
              ))}
              <Button size="sm">sm</Button>
              <Button size="icon" aria-label="icon">
                <Pencil className="size-[15px]" />
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="mono text-[11px] text-[var(--text-faint)]">{"<Input>"}</span>
            <Input className="max-w-xs" placeholder="Placeholder" />
          </div>
          <div className="flex flex-col gap-2">
            <span className="mono text-[11px] text-[var(--text-faint)]">
              {"<FormField label hint>"}
            </span>
            <FormField label="Label" hint="Hint" className="max-w-xs">
              <Input placeholder="Placeholder" />
            </FormField>
          </div>
          <div className="flex flex-col gap-2">
            <span className="mono text-[11px] text-[var(--text-faint)]">
              {"<ResetButton modified onReset label>"}
            </span>
            <div className="flex max-w-xs items-center gap-1">
              <Input defaultValue="Changed" />
              <ResetButton modified onReset={() => {}} label="Reset" />
            </div>
            <div className="flex max-w-xs items-center gap-1">
              <Input defaultValue="Original" />
              <ResetButton modified={false} onReset={() => {}} label="Reset" />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="mono text-[11px] text-[var(--text-faint)]">
              {"<LocalizedField langs activeLang defaultLang values renderEditor>"}
            </span>
            <LocalizedFieldSpecimen />
            <LocalizedFieldSpecimen inline />
          </div>
          <div className="flex flex-col gap-2">
            <span className="mono text-[11px] text-[var(--text-faint)]">{"<Badge variant>"}</span>
            <div className="flex flex-wrap items-center gap-2.5">
              {BADGE_VARIANTS.map((variant) => (
                <Badge key={variant} variant={variant}>
                  {variant}
                </Badge>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="mono text-[11px] text-[var(--text-faint)]">{"<ProBadge>"}</span>
            <div className="flex flex-wrap items-center gap-2.5">
              <ProBadge />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="mono text-[11px] text-[var(--text-faint)]">
              {"<IconTile> · actionAppearance()"}
            </span>
            <div className="flex flex-wrap items-center gap-3">
              {SPECIMEN_ACTIONS.map(([name, family]) => (
                <span key={name} className="flex items-center gap-1.5 text-[12.5px]">
                  <IconTile icon={actionAppearance(name).icon} {...familyColors(family)} />
                  {t(`actionCatalog.families.${family}`)}
                </span>
              ))}
              <IconTile
                icon={TerminalSquare}
                fg="var(--kind-command)"
                soft="var(--kind-command-soft)"
                size="lg"
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="mono text-[11px] text-[var(--text-faint)]">
              {"<FormField group label hint><Segmented>"}
            </span>
            <FormField group label="Inventory" hint="Hint">
              <Segmented
                label="Segmented"
                options={[
                  { value: "chest", label: "Chest" },
                  { value: "hopper", label: "Hopper" },
                  { value: "dropper", label: "Dropper" },
                ]}
                value={segValue}
                onChange={setSegValue}
              />
            </FormField>
          </div>
          <div className="flex flex-col gap-2">
            <span className="mono text-[11px] text-[var(--text-faint)]">
              {"<EditorHeader> · kindAppearance()"}
            </span>
            <div className="flex flex-col gap-2">
              {(["menu", "command", "dialog", "trigger"] as const).map((kind) => (
                <div key={kind} className="panel overflow-hidden rounded-[var(--r-md)]">
                  <EditorHeader
                    kind={kind}
                    eyebrow={kind.charAt(0).toUpperCase() + kind.slice(1)}
                    title={kind === "command" ? "/shop" : "Shop"}
                    meta={<span className="chip cursor-default text-[12px]">meta</span>}
                    details={
                      kind === "trigger" ? (
                        <span className="text-[13px] text-[var(--text-mut)]">
                          details: a full-width line under the row
                        </span>
                      ) : undefined
                    }
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="mono text-[11px] text-[var(--text-faint)]">.mc-text</span>
            <div className="text-[13px]">
              <MiniMessageInline
                className="mc-text"
                source="<green>Healed <white>Alex</white> for 10 hearts."
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="mono text-[11px] text-[var(--text-faint)]">{"<Skeleton>"}</span>
            <div className="flex max-w-sm flex-col gap-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-20 w-full" />
            </div>
            <p className="text-[11.5px] text-[var(--text-faint)]">
              {t("adminDesign.specimens.skeletonHint")}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <span className="mono text-[11px] text-[var(--text-faint)]">{"<Spinner>"}</span>
            <div className="flex items-center gap-2">
              <Spinner />
              <span className="text-[13px] text-[var(--text-mut)]">
                {t("adminDesign.specimens.spinnerLabel")}
              </span>
            </div>
            <p className="text-[11.5px] text-[var(--text-faint)]">
              {t("adminDesign.specimens.spinnerHint")}
            </p>
          </div>
          <SwitchSpecimen />
          <TagInputSpecimen />
          <CheckboxSpecimen />
          <SortableListSpecimen />
          <div className="flex max-w-sm flex-col gap-2">
            <span className="mono text-[11px] text-[var(--text-faint)]">
              {"<FileDropzone file onFile accept label prompt hint>"}
            </span>
            <FileDropzoneSpecimen />
          </div>
          <div className="flex flex-col gap-2">
            <span className="mono text-[11px] text-[var(--text-faint)]">
              {"<EmptyState icon title hint action>"}
            </span>
            <div className="max-w-sm rounded-[var(--r-md)] border border-[var(--border-soft)]">
              <EmptyState
                icon={Inbox}
                title="EmptyState title"
                hint="EmptyState hint"
                action={
                  <Button variant="outline" size="sm">
                    action
                  </Button>
                }
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="mono text-[11px] text-[var(--text-faint)]">{"<Tabs>"}</span>
            <Tabs defaultValue="one" className="max-w-md">
              <TabsList>
                <TabsTrigger value="one">Tab one</TabsTrigger>
                <TabsTrigger value="two">Tab two</TabsTrigger>
              </TabsList>
              <TabsContent value="one" className="pt-2 text-[13px] text-[var(--text-mut)]">
                TabsContent — one
              </TabsContent>
              <TabsContent value="two" className="pt-2 text-[13px] text-[var(--text-mut)]">
                TabsContent — two
              </TabsContent>
            </Tabs>
          </div>
          <div className="flex flex-col gap-2">
            <span className="mono text-[11px] text-[var(--text-faint)]">{"<Collapsible>"}</span>
            <div className="max-w-md">
              <Collapsible
                title={t("adminDesign.specimens.collapsibleTitle")}
                meta={<Badge variant="sage">3</Badge>}
              >
                <p className="text-[13px] text-[var(--text-mut)]">
                  {t("adminDesign.specimens.collapsibleBody")}
                </p>
              </Collapsible>
              <Collapsible title={t("adminDesign.specimens.collapsibleOpenTitle")} defaultOpen>
                <p className="text-[13px] text-[var(--text-mut)]">defaultOpen</p>
              </Collapsible>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline">{"<Dialog>"}</Button>
              </DialogTrigger>
              <DialogContent className="max-w-sm">
                <DialogHeader>
                  <DialogTitle>{t("adminDesign.demo.dialogTitle")}</DialogTitle>
                </DialogHeader>
                <DialogDescription>{t("adminDesign.demo.dialogBody")}</DialogDescription>
                <DialogFooter>
                  <Button variant="ghost" size="sm">
                    {t("adminDesign.demo.cancel")}
                  </Button>
                  <Button variant="primary" size="sm">
                    {t("adminDesign.demo.confirm")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <WorkspaceViewSpecimen />
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline">{"<Sheet>"}</Button>
              </SheetTrigger>
              <SheetContent side="right">
                <SheetHeader>
                  <SheetTitle>{t("adminDesign.demo.sheetTitle")}</SheetTitle>
                </SheetHeader>
                <SheetBody>
                  <p className="text-[13px] text-[var(--text-mut)]">
                    {t("adminDesign.demo.sheetBody")}
                  </p>
                </SheetBody>
              </SheetContent>
            </Sheet>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">{"<DropdownMenu>"}</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem>
                  <Sparkles className="size-[14px]" /> Item one
                </DropdownMenuItem>
                <DropdownMenuItem>Item two</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem>Item three</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <SearchableMenuSpecimen />
          </div>
          <div className="flex flex-col gap-2">
            <span className="mono text-[11px] text-[var(--text-faint)]">{"<Card>"}</span>
            <Card className="max-w-sm">
              <CardHeader>
                <CardTitle>CardTitle</CardTitle>
                <CardDescription>CardDescription</CardDescription>
              </CardHeader>
              <CardContent className="text-[13px] text-[var(--text-mut)]">CardContent</CardContent>
            </Card>
          </div>
        </div>
      </Section>

      {/* Search palette */}
      <Section id="search-palette" title={t("adminDesign.sections.searchPalette")}>
        <div className="card flex flex-col gap-4 p-5">
          <span className="text-[12px] text-[var(--text-mut)]">
            {t("adminDesign.demo.searchHint")}
          </span>
          {/* Static preview of the palette panel chrome */}
          <div className="w-full max-w-[420px] overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface-raised)] shadow-[var(--shadow-lg)]">
            <div className="flex items-center gap-2 border-b border-[var(--border-soft)] px-3">
              <Search className="size-4 shrink-0 text-[var(--text-faint)]" />
              <span className="h-12 flex-1 leading-[3rem] text-[14px] text-[var(--text-faint)]">
                {t("search.placeholder")}
              </span>
            </div>
            <div className="py-1">
              <div className="section-label px-3 pt-2.5 pb-1">{t("search.groupMenu")}</div>
              <div className="flex w-full items-center gap-2.5 bg-[var(--brand-soft)] px-3 py-2 text-left text-[13px] text-[var(--text)]">
                <LayoutGrid className="size-[15px] shrink-0 text-[var(--text-faint)]" />
                <span className="flex-1 truncate">Shop</span>
              </div>
              <div className="section-label px-3 pt-2.5 pb-1">{t("search.groupCommand")}</div>
              <div className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-[var(--text-mut)]">
                <TerminalSquare className="size-[15px] shrink-0 text-[var(--text-faint)]" />
                <span className="flex-1 truncate">/heal</span>
              </div>
            </div>
          </div>
          <div>
            <Button variant="outline" onClick={() => useUiStore.getState().setSearchOpen(true)}>
              <Search className="size-[15px]" /> {t("adminDesign.demo.openSearch")}
            </Button>
          </div>
        </div>
      </Section>

      {/* Canvas toolbar */}
      <Section id="canvas-toolbar" title={t("adminDesign.sections.canvasToolbar")}>
        <div className="card flex flex-col gap-4 p-5">
          <span className="mono text-[11px] text-[var(--text-faint)]">{"<CanvasToolbar>"}</span>
          <span className="text-[12px] text-[var(--text-mut)]">
            Bottom-center DOM toolbar (absolute, z-20). Two mode buttons (Select / Pan), active
            state via --brand-soft, plus a rearrange-mode dropdown. Hotkeys:{" "}
            <kbd className="mono text-[11px]">V</kbd> / <kbd className="mono text-[11px]">H</kbd> /
            Space-hold (temporary pan).
          </span>
          {/* Live render in a relative container to avoid absolute positioning overflow */}
          <div className="relative h-16 overflow-hidden rounded-[var(--r-md)] border border-[var(--border-soft)] bg-[var(--surface-inset)]">
            <CanvasToolbar onRearrange={() => {}} />
          </div>
        </div>
      </Section>

      {/* Shared app components */}
      <Section id="app-components" title={t("adminDesign.sections.appComponents")}>
        <div className="card flex flex-col gap-6 p-5">
          <div className="flex flex-col gap-2">
            <span className="mono text-[11px] text-[var(--text-faint)]">{"<ThemeSwitcher>"}</span>
            <ThemeSwitcher />
          </div>
          <div className="flex flex-col gap-2">
            <span className="mono text-[11px] text-[var(--text-faint)]">{"<SplitPane>"}</span>
            <div className="h-40 overflow-hidden rounded-[var(--r-md)] border border-[var(--border-soft)]">
              <SplitPane
                orientation="horizontal"
                primary={
                  <div className="flex h-full items-center justify-center text-[12px] text-[var(--text-faint)]">
                    primary
                  </div>
                }
                secondary={
                  <div className="flex h-full items-center justify-center text-[12px] text-[var(--text-faint)]">
                    secondary
                  </div>
                }
                secondarySize={splitSize}
                onSecondarySizeChange={setSplitSize}
                minSecondary={80}
                minPrimary={120}
              />
            </div>
          </div>
        </div>
      </Section>

      {/* Code editor */}
      <Section id="codeEditor" title={t("adminDesign.sections.codeEditor")}>
        <div className="card flex flex-col gap-2 p-5">
          <span className="mono text-[11px] text-[var(--text-faint)]">{"<YamlCodeEditor>"}</span>
          <p className="text-[11px] text-[var(--text-faint)]">{t("adminDesign.codeEditorHint")}</p>
          <div className="h-48 overflow-auto rounded border border-[var(--border-soft)] bg-[var(--surface)]">
            <YamlCodeEditor value={SAMPLE_YAML} ariaLabel="YamlCodeEditor" onChange={() => {}} />
          </div>
          <span className="mono text-[11px] text-[var(--text-faint)]">
            {"<YamlCodeEditor readOnly>"}
          </span>
          <p className="text-[11px] text-[var(--text-faint)]">
            {t("adminDesign.codeEditorReadOnlyHint")}
          </p>
          <div className="h-32 overflow-auto rounded border border-[var(--border-soft)] bg-[var(--surface)]">
            <YamlCodeEditor value={SAMPLE_YAML} ariaLabel="YamlCodeEditor readOnly" readOnly />
          </div>
        </div>
      </Section>

      <Section id="minimessage" title={t("adminDesign.sections.minimessage")}>
        <MiniMessageSpecimens />
      </Section>

      <Section id="dataViz" title={t("adminDesign.sections.dataViz")}>
        <div className="card flex flex-col gap-6 p-5">
          <div className="flex flex-col gap-2">
            <span className="mono text-[11px] text-[var(--text-faint)]">{"<StatCard>"}</span>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StatCard label="Requests" value="1,204" sub="last 24h" />
              <StatCard label="Margin" value="+$12.30" tone="positive" sub="vs cost" />
              <StatCard label="Margin" value="-$0.50" tone="negative" sub="vs cost" />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="mono text-[11px] text-[var(--text-faint)]">{"<HBar>"}</span>
            <div className="flex max-w-md flex-col gap-3">
              <HBar label="gpt-4o-mini" value={75} max={100} caption="75%" />
              <HBar label="claude-3-haiku" value={25} max={100} caption="25%" />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="mono text-[11px] text-[var(--text-faint)]">{"<Table>"}</span>
            <Table>
              <THead>
                <TR>
                  <TH>Model</TH>
                  <TH align="right">Cost</TH>
                </TR>
              </THead>
              <TBody>
                <TR>
                  <TD>gpt-4o-mini</TD>
                  <TD align="right">$0.42</TD>
                </TR>
                <TR>
                  <TD>claude-3-haiku</TD>
                  <TD align="right">$0.18</TD>
                </TR>
              </TBody>
            </Table>
          </div>
          <div className="flex flex-col gap-2">
            <span className="mono text-[11px] text-[var(--text-faint)]">{"<DataTable>"}</span>
            {/* Nested rows are what the YAML view exists for: `stages` is a blob
                in a table cell, a foldable tree in YAML. */}
            <DataTable
              rows={[
                {
                  id: "daily:mine_stone",
                  price: 10,
                  tags: ["pvp"],
                  stages: [{ key: "stage_1", objectives: [{ key: "obj_1", target: 64 }] }],
                },
                { id: "bow", price: 30, tags: null, stages: [] },
              ]}
              truncated
              truncatedLabel="Results truncated."
              tableLabel="Table"
              yamlLabel="YAML"
            />
          </div>
        </div>
      </Section>
    </div>
  );
}

/** In-flow secondary view for the workspace (Translations, Data sources,
 *  History, Assistant) — REPLACES the canvas in the center region instead of
 *  floating as a modal. Opaque, keep-alive; Esc / × return to the canvas. Shown
 *  here inside a relative demo box (it absolutely fills its positioned parent). */
function FileDropzoneSpecimen() {
  const [file, setFile] = useState<File | null>(null);
  return (
    <FileDropzone
      file={file}
      onFile={setFile}
      accept="image/png"
      label="FileDropzone"
      prompt="FileDropzone prompt"
      hint="FileDropzone hint"
      clearLabel="clear"
    />
  );
}

function WorkspaceViewSpecimen() {
  const { t } = useTranslation();
  const [active, setActive] = useState(false);
  return (
    <div className="relative h-56 overflow-hidden rounded-[var(--r-lg)] border border-[var(--border-soft)]">
      <div className="flex h-full items-center justify-center">
        <Button variant="outline" onClick={() => setActive(true)}>
          {"<WorkspaceView>"}
        </Button>
      </div>
      <WorkspaceView active={active} onExit={() => setActive(false)} title="WorkspaceView">
        <p className="text-[13px] text-[var(--text-mut)]">
          {t("adminDesign.specimens.workspaceViewBody")}
        </p>
      </WorkspaceView>
    </div>
  );
}

function CheckboxSpecimen() {
  const { t } = useTranslation();
  const [on, setOn] = useState(true);
  return (
    <div className="flex flex-col gap-2">
      <span className="mono text-[11px] text-[var(--text-faint)]">
        {"<Checkbox checked onCheckedChange>"}
      </span>
      <div className="flex items-center gap-3">
        <Checkbox
          checked={on}
          onCheckedChange={setOn}
          aria-label={t("adminDesign.specimens.applyToAll")}
        />
        <Checkbox
          checked={false}
          disabled
          onCheckedChange={() => {}}
          aria-label={t("adminDesign.specimens.disabled")}
        />
      </div>
      <p className="text-[11.5px] text-[var(--text-faint)]">
        {t("adminDesign.specimens.checkboxHint")}
      </p>
    </div>
  );
}

function SortableListSpecimen() {
  const { t } = useTranslation();
  const [rows, setRows] = useState(() => [
    t("adminDesign.specimens.sortableRow1"),
    t("adminDesign.specimens.sortableRow2"),
    t("adminDesign.specimens.sortableRow3"),
  ]);
  return (
    <div className="flex max-w-sm flex-col gap-2">
      <span className="mono text-[11px] text-[var(--text-faint)]">
        {"<SortableList ids onMove>{(index, handle) => …}</SortableList>"}
      </span>
      <SortableList
        ids={rows}
        onMove={(from, to) =>
          setRows((list) => {
            const next = [...list];
            next.splice(to, 0, next.splice(from, 1)[0]!);
            return next;
          })
        }
        className="flex flex-col gap-1"
        itemClassName="flex items-center gap-2 rounded-[10px] border border-[var(--border-soft)] bg-[var(--surface-raised)] py-1.5 pr-3 pl-1"
      >
        {(index, handle) => (
          <>
            {handle}
            <span className="text-[13px] text-[var(--text)]">{rows[index]}</span>
          </>
        )}
      </SortableList>
      <p className="text-[11.5px] text-[var(--text-faint)]">
        {t("adminDesign.specimens.sortableHint")}
      </p>
    </div>
  );
}

function SwitchSpecimen() {
  const { t } = useTranslation();
  const [on, setOn] = useState(true);
  return (
    <div className="flex flex-col gap-2">
      <span className="mono text-[11px] text-[var(--text-faint)]">
        {"<Switch checked onCheckedChange>"}
      </span>
      <div className="flex items-center gap-3">
        <Switch
          checked={on}
          onCheckedChange={setOn}
          aria-label={t("adminDesign.specimens.defaultTexture")}
        />
        <Switch
          checked={false}
          disabled
          onCheckedChange={() => {}}
          aria-label={t("adminDesign.specimens.disabled")}
        />
      </div>
      <p className="text-[11.5px] text-[var(--text-faint)]">
        {t("adminDesign.specimens.switchHint")}
      </p>
    </div>
  );
}

function TagInputSpecimen() {
  const { t } = useTranslation();
  const [values, setValues] = useState(["1h", "6h", "24h"]);
  return (
    <div className="flex max-w-sm flex-col gap-2">
      <span className="mono text-[11px] text-[var(--text-faint)]">
        {"<TagInput values onAdd onRemove label removeLabel>"}
      </span>
      <TagInput
        values={values}
        label={t("dataSources.addValue")}
        placeholder={t("dataSources.addValuePlaceholder")}
        removeLabel={(v) => t("dataSources.removeValue", { value: v })}
        onAdd={(v) => {
          setValues((prev) => [...prev, v]);
          return true;
        }}
        onRemove={(i) => setValues((prev) => prev.filter((_, j) => j !== i))}
      />
    </div>
  );
}

/** `DropdownMenuSearch`: the field filters the items as one types; ↓ then Enter picks. */
function SearchableMenuSpecimen() {
  const [query, setQuery] = useState("");
  const items = ["Ouvrir un menu", "Fermer le menu", "Donner un objet", "Téléporter"].filter((i) =>
    matchesMenuSearch(i, query),
  );
  return (
    <DropdownMenu onOpenChange={(open) => !open && setQuery("")}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">{"<DropdownMenuSearch>"}</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuSearch value={query} onValueChange={setQuery} placeholder="Search…" />
        {items.map((i) => (
          <DropdownMenuItem key={i}>{i}</DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ResizeHandleSpecimen() {
  const [width, setWidth] = useState(320);
  const clamp = (w: number) => Math.round(Math.min(560, Math.max(200, w)));
  return (
    <div
      className="card relative h-28 p-4 pr-5 text-[13px] text-[var(--text-mut)]"
      style={{ width }}
    >
      <ResizeHandle
        edge="right"
        value={width}
        min={200}
        max={560}
        onResize={(w) => setWidth(clamp(w))}
        onReset={() => setWidth(320)}
        label="Resize"
      />
      {width}px
    </div>
  );
}
