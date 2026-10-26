import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { parseDocRef, projectNamespace } from "@/domain/docRef";
import { documentsOf, menusOf } from "@/domain/documents";
import { getFirstTitleText } from "@/domain/menuTitle";
import type { MenuId, ProjectId } from "@/domain/types";
import { useOtherServerProjects } from "@/features/serverIndex/useOtherServerProjects";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { getText as libGetText } from "@/lib/i18n";
import { useGetText } from "@/lib/useText";
import { useProjectsStore } from "@/state/projectsStore";
import { useUiStore } from "@/state/uiStore";
import { useTranslation } from "react-i18next";

export interface DocumentRefFieldProps {
  projectId: string;
  /** The Document kind referenced (`menu`, `quest_group`…). */
  kind: string;
  /** The Document's id, `project:id` for another project's; "" for none. */
  value: string;
  /** The picked reference; "" when cleared. */
  onChange: (id: string) => void;
  /** The select's accessible name; a menu's picker is named by the menu it shows. */
  "aria-label"?: string;
}

/**
 * A reference to a Document (ADR `extensible-document-kinds`, R3): the Documents of that
 * kind in this project and, qualified `project:id`, in the other projects of the server.
 * A menu is picked from a titled dropdown, any other kind from a select.
 */
export function DocumentRefField(p: DocumentRefFieldProps) {
  if (p.kind === "menu") return <MenuRefInput {...p} />;
  return <KindRefSelect {...p} />;
}

function MenuOptionLabel({ id, title }: { id: string; title: string }) {
  return (
    <span className="truncate">
      {id}
      {title ? (
        <>
          {" · "}
          <MiniMessageInline source={title} />
        </>
      ) : null}
    </span>
  );
}

function MenuRefInput({ projectId, value, onChange }: DocumentRefFieldProps) {
  const { t } = useTranslation();
  const menuId = value as MenuId;
  const menus = useProjectsStore((s) =>
    menusOf(s.openProjects.projects.find((p) => p.id === projectId)),
  );
  const others = useOtherServerProjects(projectId);
  const activeLang = useUiStore((s) => s.activeLang);
  const getText = useGetText(projectId as ProjectId);
  // A qualified target (`boutique:main`) lives in another project: it is read
  // from the server index (published state) for its title and inputs.
  const ref = parseDocRef(menuId);
  const remote =
    ref.namespace === null
      ? null
      : (others
          .filter((p) => projectNamespace(p) === ref.namespace)
          .flatMap((p) =>
            menusOf(p)
              .filter((m) => m.id === ref.id)
              .map((m) => ({ project: p, menu: m })),
          )[0] ?? null);
  const targetMenu = remote ? remote.menu : menus.find((m) => m.id === menuId);
  const targetTitle = remote
    ? libGetText(remote.project, getFirstTitleText(remote.menu), activeLang)
    : targetMenu
      ? getText(getFirstTitleText(targetMenu))
      : "";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-1 truncate rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] px-2 py-1 text-left font-mono text-xs text-[var(--text)]"
        >
          {targetMenu ? (
            <MenuOptionLabel id={menuId} title={targetTitle} />
          ) : menuId === "" ? (
            t("actionEditor.choose")
          ) : (
            t("actionEditor.menuMissing", { id: menuId })
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
        <DropdownMenuRadioGroup value={menuId} onValueChange={(v) => onChange(v)}>
          {menus.map((m) => (
            <DropdownMenuRadioItem key={m.id} value={m.id} className="font-mono text-xs">
              <MenuOptionLabel id={m.id} title={getText(getFirstTitleText(m))} />
            </DropdownMenuRadioItem>
          ))}
          {others
            .filter((p) => menusOf(p).length > 0)
            .map((p) => (
              <DropdownMenuGroup key={p.id}>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="field-label !mb-0">{p.name}</DropdownMenuLabel>
                {menusOf(p).map((m) => (
                  <DropdownMenuRadioItem
                    key={m.id}
                    value={`${projectNamespace(p)}:${m.id}`}
                    className="font-mono text-xs"
                  >
                    <MenuOptionLabel
                      id={m.id}
                      title={libGetText(p, getFirstTitleText(m), activeLang)}
                    />
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuGroup>
            ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function KindRefSelect({
  projectId,
  kind,
  value,
  onChange,
  "aria-label": ariaLabel,
}: DocumentRefFieldProps) {
  const { t } = useTranslation();
  const local = useProjectsStore((s) =>
    documentsOf(
      s.openProjects.projects.find((p) => p.id === projectId),
      kind,
    ),
  );
  const others = useOtherServerProjects(projectId).filter((p) => documentsOf(p, kind).length > 0);
  const known =
    local.some((d) => d.id === value) ||
    others.some((p) =>
      documentsOf(p, kind).some((d) => `${projectNamespace(p)}:${d.id}` === value),
    );
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] px-2 py-1 font-mono text-xs text-[var(--text)]"
      aria-label={ariaLabel}
    >
      {known ? null : <option value={value}>{value || t("actionEditor.choose")}</option>}
      {local.map((d) => (
        <option key={d.id} value={d.id}>
          {d.id}
        </option>
      ))}
      {others.map((p) => (
        <optgroup key={p.id} label={p.name}>
          {documentsOf(p, kind).map((d) => (
            <option key={d.id} value={`${projectNamespace(p)}:${d.id}`}>
              {d.id}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
