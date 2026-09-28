import type { DocumentKind } from "@/features/canvas/serverGraph";
import { cn } from "@/lib/cx";
import { Link } from "@tanstack/react-router";
import {
  ChevronRight,
  LayoutGrid,
  MessageSquare,
  Puzzle,
  Settings,
  TerminalSquare,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { RegistryGroup, RegistryItem } from "./registryTree";

const KIND_ICON: Record<DocumentKind, typeof LayoutGrid> = {
  menu: LayoutGrid,
  command: TerminalSquare,
  dialog: MessageSquare,
};

/**
 * Le registre serveur : un seul arbre à gauche de la planche, qui remplace la
 * liste projects/modules de la sidebar et le rail des Documents d'un project
 * (spec `server-registry-and-derived-canvas`, décision 10 bis).
 *
 * Chaque geste a un seul sens : le chevron replie, la case filtre la planche,
 * un clic sur un Document le sélectionne (et la planche va le montrer), un clic
 * sur un Config screen l'ouvre.
 */
export function ServerRegistry({
  networkId,
  serverId,
  groups,
  unlinked,
  selected,
  query,
  onQueryChange,
  onToggleGroup,
  onSelect,
}: {
  networkId: string;
  serverId: string;
  groups: RegistryGroup[];
  unlinked: RegistryItem[];
  selected: string | undefined;
  query: string;
  onQueryChange: (q: string) => void;
  onToggleGroup: (group: RegistryGroup) => void;
  onSelect: (item: RegistryItem) => void;
}) {
  const { t } = useTranslation();
  // Un seul project : pas d'en-tête de groupe, il ne distinguerait rien
  // (spec, décision 12). Un module installé compte comme un groupe à part.
  const flat = groups.length === 1 && groups[0]!.moduleId == null;

  return (
    <nav
      aria-label={t("serverCanvas.registry.label")}
      data-testid="server-registry"
      className="flex h-full min-h-0 flex-col border-r border-[var(--border)] bg-[var(--surface)]"
    >
      <div className="p-2">
        <input
          className="input h-8 w-full"
          placeholder={t("serverCanvas.search")}
          aria-label={t("serverCanvas.search")}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        {groups.length === 0 && (
          <p className="px-2 py-3 text-[12px] text-[var(--text-faint)]">
            {t("serverCanvas.noMatch")}
          </p>
        )}
        {flat ? (
          <GroupBody
            group={groups[0]!}
            networkId={networkId}
            serverId={serverId}
            selected={selected}
            onSelect={onSelect}
          />
        ) : (
          groups.map((g) => (
            <Group
              key={g.id}
              group={g}
              networkId={networkId}
              serverId={serverId}
              selected={selected}
              onToggle={() => onToggleGroup(g)}
              onSelect={onSelect}
            />
          ))
        )}
        {unlinked.length > 0 && (
          <div className="mt-3 border-t border-[var(--border-soft)] pt-2">
            <div className="eyebrow px-2 pb-1">
              {t("serverCanvas.gutter")} ({unlinked.length})
            </div>
            {unlinked.map((it) => (
              <ItemRow key={it.key} item={it} selected={selected} onSelect={onSelect} />
            ))}
          </div>
        )}
      </div>
    </nav>
  );
}

function Group({
  group,
  networkId,
  serverId,
  selected,
  onToggle,
  onSelect,
}: {
  group: RegistryGroup;
  networkId: string;
  serverId: string;
  selected: string | undefined;
  onToggle: () => void;
  onSelect: (item: RegistryItem) => void;
}) {
  const { t } = useTranslation();
  const holdsSelection =
    selected != null && group.sections.some((s) => s.items.some((i) => i.key === selected));
  const [open, setOpen] = useState(holdsSelection);
  // La sélection arrive d'ailleurs (recherche, clic sur la planche, lien
  // partagé) : on déplie son groupe pour qu'elle soit visible dans l'arbre.
  useEffect(() => {
    if (holdsSelection) setOpen(true);
  }, [holdsSelection]);
  const count = group.sections.reduce((n, s) => n + s.items.length, 0);
  const canFilter = group.projectIds.length > 0;

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1 rounded-[10px] pr-1 hover:bg-[var(--surface-hover)]">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-[10px] px-1.5 py-1.5 text-left text-[13px] font-semibold text-[var(--text)]"
        >
          <ChevronRight
            className={cn("size-3.5 shrink-0 text-[var(--text-faint)] transition-transform", {
              "rotate-90": open,
            })}
          />
          {group.moduleId && <Puzzle className="size-3.5 shrink-0 text-[var(--text-faint)]" />}
          <span className={cn("truncate", { "text-[var(--text-faint)]": group.hidden })}>
            {group.label}
          </span>
          <span className="ml-auto shrink-0 text-[11px] font-normal text-[var(--text-faint)]">
            {count}
          </span>
        </button>
        {canFilter && (
          <input
            type="checkbox"
            checked={!group.hidden}
            onChange={onToggle}
            aria-label={t(
              group.hidden ? "serverCanvas.registry.show" : "serverCanvas.registry.hide",
              { name: group.label },
            )}
            title={t(group.hidden ? "serverCanvas.registry.show" : "serverCanvas.registry.hide", {
              name: group.label,
            })}
            className="size-3.5 shrink-0 cursor-pointer accent-[var(--brand)]"
          />
        )}
      </div>
      {open && (
        <div className="ml-3 border-l border-[var(--border)] pl-1">
          <GroupBody
            group={group}
            networkId={networkId}
            serverId={serverId}
            selected={selected}
            onSelect={onSelect}
          />
        </div>
      )}
    </div>
  );
}

function GroupBody({
  group,
  networkId,
  serverId,
  selected,
  onSelect,
}: {
  group: RegistryGroup;
  networkId: string;
  serverId: string;
  selected: string | undefined;
  onSelect: (item: RegistryItem) => void;
}) {
  const { t } = useTranslation();
  if (group.sections.length === 0 && group.screens.length === 0) {
    return (
      <p className="px-2 py-1.5 text-[12px] text-[var(--text-faint)]">
        {t("serverCanvas.registry.empty")}
      </p>
    );
  }
  return (
    <div className={cn("flex flex-col", { "opacity-60": group.hidden })}>
      {group.sections.map((s) => (
        <div key={s.kind} className="flex flex-col">
          <div className="px-2 pt-1.5 pb-0.5 text-[9.5px] font-bold uppercase tracking-[.14em] text-[var(--text-faint)]">
            {t(`serverCanvas.kinds.${s.kind}`)}
          </div>
          {s.items.map((it) => (
            <ItemRow
              key={it.key}
              item={it}
              selected={selected}
              onSelect={onSelect}
              showUnlinked={!group.hidden}
            />
          ))}
        </div>
      ))}
      {group.screens.map((screen) => (
        <Link
          key={screen.id}
          to="/networks/$networkId/servers/$serverId/screens/$screenId"
          params={{ networkId, serverId, screenId: screen.id }}
          className="flex items-center gap-2 rounded-[8px] px-2 py-1.5 text-[13px] text-[var(--text-mut)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        >
          <Settings className="size-[14px] shrink-0 text-[var(--text-faint)]" />
          <span className="truncate">{screen.label}</span>
        </Link>
      ))}
    </div>
  );
}

function ItemRow({
  item,
  selected,
  onSelect,
  showUnlinked = false,
}: {
  item: RegistryItem;
  selected: string | undefined;
  onSelect: (item: RegistryItem) => void;
  showUnlinked?: boolean;
}) {
  const { t } = useTranslation();
  const Icon = KIND_ICON[item.kind];
  const isSelected = item.key === selected;
  return (
    <button
      type="button"
      aria-current={isSelected ? "true" : undefined}
      onClick={() => onSelect(item)}
      className={cn(
        "flex items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[13px]",
        isSelected
          ? "bg-[var(--brand-soft)] font-medium text-[var(--text)]"
          : "text-[var(--text-mut)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
      )}
    >
      <Icon className="size-[14px] shrink-0 text-[var(--text-faint)]" />
      <span className="flex-1 truncate" title={item.docId}>
        {item.label}
      </span>
      {showUnlinked && !item.linked && (
        <span
          className="size-1.5 shrink-0 rounded-full bg-[var(--text-faint)]"
          title={t("serverCanvas.gutter")}
        />
      )}
    </button>
  );
}
