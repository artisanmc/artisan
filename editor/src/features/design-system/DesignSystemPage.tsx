import { SplitPane } from "@/components/SplitPane";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { HBar } from "@/components/ui/h-bar";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { StatCard } from "@/components/ui/stat-card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WorkspaceView } from "@/components/ui/workspace-view";
import { CanvasToolbar } from "@/features/canvas/CanvasToolbar";
import { useUiStore } from "@/state/uiStore";
import { Inbox, LayoutGrid, Pencil, Plus, Search, Sparkles, TerminalSquare } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Living style guide rendered at /admin/design. Every token, utility class
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
];

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
const BADGE_VARIANTS = ["amber", "sage", "terra", "brick"] as const;
const BADGE_CLASSES = ["badge-amber", "badge-sage", "badge-terra", "badge-brick"];

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

  return (
    <div className="flex flex-col gap-10">
      {/* ── Rules ─────────────────────────────────────────────────────── */}
      <Section id="guidelines" title={t("adminDesign.guidelines.heading")}>
        <div className="card p-5">
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[13px] text-[var(--text-mut)]">
            {(["rule1", "rule2", "rule3", "rule4", "rule5"] as const).map((k) => (
              <li key={k}>{t(`adminDesign.guidelines.${k}`)}</li>
            ))}
          </ul>
        </div>
      </Section>

      {/* ── Color tokens ──────────────────────────────────────────────── */}
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

      {/* ── Typography ────────────────────────────────────────────────── */}
      <Section id="typography" title={t("adminDesign.sections.typography")}>
        <div className="card flex flex-col gap-5 p-5">
          <div className="flex flex-col gap-1">
            <span className="mono text-[11px] text-[var(--text-faint)]">
              .display / --font-display
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
        </div>
      </Section>

      {/* ── Radii & shadows ───────────────────────────────────────────── */}
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

      {/* ── CSS utility classes ───────────────────────────────────────── */}
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

      {/* ── React primitives (components/ui) ──────────────────────────── */}
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

      {/* ── Search palette ────────────────────────────────────────────── */}
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
              <div className="px-3 pt-2 pb-1 text-[9.5px] font-bold uppercase tracking-[.14em] text-[var(--text-faint)]">
                {t("search.groupMenu")}
              </div>
              <div className="flex w-full items-center gap-2.5 bg-[var(--brand-soft)] px-3 py-2 text-left text-[13px] text-[var(--text)]">
                <LayoutGrid className="size-[15px] shrink-0 text-[var(--text-faint)]" />
                <span className="flex-1 truncate">Shop</span>
              </div>
              <div className="px-3 pt-2 pb-1 text-[9.5px] font-bold uppercase tracking-[.14em] text-[var(--text-faint)]">
                {t("search.groupCommand")}
              </div>
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

      {/* ── Canvas toolbar ────────────────────────────────────────────── */}
      <Section id="canvas-toolbar" title={t("adminDesign.sections.canvasToolbar")}>
        <div className="card flex flex-col gap-4 p-5">
          <span className="mono text-[11px] text-[var(--text-faint)]">{"<CanvasToolbar>"}</span>
          <span className="text-[12px] text-[var(--text-mut)]">
            Bottom-center DOM toolbar (absolute, z-20). Two mode buttons (Select / Pan), active
            state via --brand-soft. Hotkeys: <kbd className="mono text-[11px]">V</kbd> /{" "}
            <kbd className="mono text-[11px]">H</kbd> / Space-hold (temporary pan).
          </span>
          {/* Live render in a relative container to avoid absolute positioning overflow */}
          <div className="relative h-16 overflow-hidden rounded-[var(--r-md)] border border-[var(--border-soft)] bg-[var(--surface-inset)]">
            <CanvasToolbar />
          </div>
        </div>
      </Section>

      {/* ── Shared app components ─────────────────────────────────────── */}
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

      {/* ── Data viz ──────────────────────────────────────────────────── */}
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
            <DataTable
              rows={[
                { id: "sword", price: 10, tags: ["pvp"] },
                { id: "bow", price: 30, tags: null },
              ]}
              truncated
              truncatedLabel="Results truncated."
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
function WorkspaceViewSpecimen() {
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
          Vue de travail qui remplace le canvas dans la zone centrale (panneau opaque, keep-alive).
          Le canvas reste monté dessous — jamais display:none. Échap / × reviennent au canvas.
        </p>
      </WorkspaceView>
    </div>
  );
}
