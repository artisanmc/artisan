import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  type ImportSource,
  type ImportSourceFile,
  listImportSources,
} from "@/lib/api/importSources";
import { ChevronDown, ChevronRight, FileText, Folder, Search } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type ImportTreeNode,
  buildImportTree,
  filterImportTree,
  selectionState,
  summarizeSelection,
  toggleTreePath,
} from "./importSourceTree";

const MAX_FILES = 200;
const MAX_BYTES = 8 * 1024 * 1024;
const EMPTY_GROUPS: ServerAttachmentGroup[] = [];

export interface ServerAttachmentGroup {
  sourceId: string;
  label: string;
  files: ImportSourceFile[];
}

interface ServerImportSourceDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  networkId: string;
  serverId: string;
  projectId: string;
  onAttach(groups: ServerAttachmentGroup[]): void;
  existingGroups?: ServerAttachmentGroup[];
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; sources: ImportSource[] }
  | { kind: "error"; error: "server_offline" | "fetch_timeout" | "read_error" | "network_error" };

function TreeRow({
  node,
  fullNode = node,
  depth,
  selected,
  expanded,
  forceExpanded,
  onToggleSelection,
  onToggleExpanded,
}: {
  node: ImportTreeNode;
  fullNode?: ImportTreeNode;
  depth: number;
  selected: Set<string>;
  expanded: Set<string>;
  forceExpanded: boolean;
  onToggleSelection(node: ImportTreeNode, checked: boolean): void;
  onToggleExpanded(path: string): void;
}) {
  const { t } = useTranslation();
  const state = selectionState(selected, fullNode);
  const isDirectory = node.kind === "directory";
  const isExpanded = forceExpanded || expanded.has(node.path);
  const checkboxLabel = t("assistant.serverFiles.select", { name: node.name });
  const checkboxId = useId();

  return (
    <li>
      <div
        className="flex min-h-8 items-center gap-1 rounded-[var(--r-sm)] pr-2 hover:bg-[var(--surface-hover)]"
        style={{ paddingLeft: `${depth * 18 + 4}px` }}
      >
        {isDirectory ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            aria-label={t(
              isExpanded ? "assistant.serverFiles.collapse" : "assistant.serverFiles.expand",
              {
                name: node.name,
              },
            )}
            aria-expanded={isExpanded}
            onClick={() => onToggleExpanded(node.path)}
          >
            {isExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </Button>
        ) : (
          <span className="w-7 shrink-0" />
        )}
        <label
          htmlFor={checkboxId}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-1 text-sm text-[var(--text)]"
        >
          <Input
            id={checkboxId}
            type="checkbox"
            checked={state === "all"}
            ref={(input) => {
              if (input) input.indeterminate = state === "some";
            }}
            aria-label={checkboxLabel}
            className="!size-4 shrink-0 !appearance-auto !rounded-[var(--r-sm)] !p-0 accent-[var(--brand)]"
            onChange={(event) => onToggleSelection(fullNode, event.target.checked)}
          />
          {isDirectory ? (
            <Folder className="size-4 shrink-0 text-[var(--text-mut)]" />
          ) : (
            <FileText className="size-4 shrink-0 text-[var(--text-mut)]" />
          )}
          <span className="truncate">{node.name}</span>
        </label>
        <span className="shrink-0 text-xs tabular-nums text-[var(--text-faint)]">
          {formatBytes(node.size)}
        </span>
      </div>
      {isDirectory && isExpanded && node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <TreeRow
              key={child.path}
              node={child}
              fullNode={fullNode.children.find((item) => item.path === child.path)}
              depth={depth + 1}
              selected={selected}
              expanded={expanded}
              forceExpanded={forceExpanded}
              onToggleSelection={onToggleSelection}
              onToggleExpanded={onToggleExpanded}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function ServerImportSourceDialog({
  open,
  onOpenChange,
  networkId,
  serverId,
  projectId,
  onAttach,
  existingGroups = EMPTY_GROUPS,
}: ServerImportSourceDialogProps) {
  const { t } = useTranslation();
  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [activeSourceId, setActiveSourceId] = useState("");
  const [selectedBySource, setSelectedBySource] = useState<Record<string, Set<string>>>({});
  const [expandedBySource, setExpandedBySource] = useState<Record<string, Set<string>>>({});
  const [query, setQuery] = useState("");
  const requestId = useRef(0);

  const loadSources = useCallback(async () => {
    const currentRequest = requestId.current + 1;
    requestId.current = currentRequest;
    setLoadState({ kind: "loading" });
    try {
      const result = await listImportSources(networkId, serverId, projectId);
      if (requestId.current !== currentRequest) return;
      if (!result.ok) {
        setLoadState({ kind: "error", error: result.error });
        return;
      }
      setLoadState({ kind: "ready", sources: result.sources });
      setSelectedBySource((current) =>
        Object.fromEntries(
          result.sources
            .filter((source) => !source.error)
            .map((source) => [
              source.id,
              new Set(
                source.files
                  .filter((file) => current[source.id]?.has(file.path))
                  .map((file) => file.path),
              ),
            ]),
        ),
      );
      setActiveSourceId((current) =>
        result.sources.some((source) => source.id === current)
          ? current
          : (result.sources[0]?.id ?? ""),
      );
    } catch {
      if (requestId.current === currentRequest) {
        setLoadState({ kind: "error", error: "read_error" });
      }
    }
  }, [networkId, projectId, serverId]);

  useEffect(() => {
    if (open) {
      setSelectedBySource(
        Object.fromEntries(
          existingGroups.map((group) => [
            group.sourceId,
            new Set(group.files.map((file) => file.path)),
          ]),
        ),
      );
      void loadSources();
    }
    return () => {
      requestId.current += 1;
    };
  }, [loadSources, open, existingGroups]);

  const sources = loadState.kind === "ready" ? loadState.sources : [];
  const activeSource = sources.find((source) => source.id === activeSourceId) ?? sources[0];
  const trees = useMemo(
    () => new Map(sources.map((source) => [source.id, buildImportTree(source.files)])),
    [sources],
  );
  const activeTree = activeSource ? (trees.get(activeSource.id) ?? []) : [];
  const visibleTree = useMemo(() => filterImportTree(activeTree, query), [activeTree, query]);
  const activeSelected = activeSource
    ? (selectedBySource[activeSource.id] ?? new Set<string>())
    : new Set<string>();
  const activeExpanded = activeSource
    ? (expandedBySource[activeSource.id] ?? new Set<string>())
    : new Set<string>();
  const total = sources.reduce(
    (summary, source) => {
      if (source.error) return summary;
      const next = summarizeSelection(
        selectedBySource[source.id] ?? new Set(),
        trees.get(source.id) ?? [],
      );
      return { count: summary.count + next.count, bytes: summary.bytes + next.bytes };
    },
    { count: 0, bytes: 0 },
  );
  const overLimit = total.count > MAX_FILES || total.bytes > MAX_BYTES;
  const fileTooLarge = sources.some(
    (source) =>
      !source.error &&
      source.files.some(
        (file) => selectedBySource[source.id]?.has(file.path) && file.size > 1024 * 1024,
      ),
  );

  function toggleSelection(node: ImportTreeNode, checked: boolean) {
    if (!activeSource) return;
    setSelectedBySource((current) => {
      const selected = current[activeSource.id] ?? new Set<string>();
      return {
        ...current,
        [activeSource.id]: toggleTreePath(selected, node, checked),
      };
    });
  }

  function toggleExpanded(path: string) {
    if (!activeSource) return;
    setExpandedBySource((current) => {
      const expanded = new Set(current[activeSource.id] ?? []);
      if (expanded.has(path)) expanded.delete(path);
      else expanded.add(path);
      return { ...current, [activeSource.id]: expanded };
    });
  }

  function attachSelection() {
    if (total.count === 0 || overLimit || fileTooLarge || loadState.kind !== "ready") return;
    const groups = sources.flatMap((source) => {
      if (source.error) return [];
      const selected = selectedBySource[source.id] ?? new Set<string>();
      const files = source.files
        .filter((file) => selected.has(file.path))
        .sort((a, b) => (a.path === b.path ? 0 : a.path < b.path ? -1 : 1));
      return files.length > 0 ? [{ sourceId: source.id, label: source.label, files }] : [];
    });
    onAttach(groups);
    closeDialog();
  }

  function closeDialog() {
    setActiveSourceId("");
    setSelectedBySource({});
    setExpandedBySource({});
    setQuery("");
    onOpenChange(false);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      closeDialog();
      return;
    }
    onOpenChange(true);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[min(82vh,720px)] w-[calc(100vw-2rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-[var(--border-soft)] px-5 py-4 pr-12">
          <DialogTitle>{t("assistant.serverFiles.title")}</DialogTitle>
          <DialogDescription>{t("assistant.serverFiles.description")}</DialogDescription>
        </DialogHeader>

        {loadState.kind === "loading" && (
          <div className="flex min-h-72 items-center justify-center px-5 text-sm text-[var(--text-mut)]">
            {t("assistant.serverFiles.loading")}
          </div>
        )}

        {loadState.kind === "error" && (
          <div className="flex min-h-72 flex-col items-start justify-center gap-4 px-5">
            <p className="text-sm text-[var(--text-mut)]">
              {t(`assistant.serverFiles.${loadState.error}`)}
            </p>
            <Button type="button" variant="outline" onClick={loadSources}>
              {t("assistant.serverFiles.retry")}
            </Button>
          </div>
        )}

        {loadState.kind === "ready" && sources.length === 0 && (
          <div className="flex min-h-72 flex-col items-center justify-center gap-4 px-5 text-center text-sm text-[var(--text-mut)]">
            <p>{t("assistant.serverFiles.noSources")}</p>
            <Button type="button" variant="outline" onClick={loadSources}>
              {t("assistant.serverFiles.refresh")}
            </Button>
          </div>
        )}

        {loadState.kind === "ready" && sources.length > 0 && (
          <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
            <nav
              aria-label={t("assistant.serverFiles.sourcesLabel")}
              className="flex shrink-0 gap-1 overflow-x-auto border-b border-[var(--border-soft)] p-3 sm:w-48 sm:flex-col sm:border-b-0 sm:border-r"
            >
              {sources.map((source) => (
                <Button
                  key={source.id}
                  type="button"
                  variant={source.id === activeSource?.id ? "secondary" : "ghost"}
                  size="sm"
                  aria-pressed={source.id === activeSource?.id}
                  className="shrink-0 justify-start"
                  onClick={() => setActiveSourceId(source.id)}
                >
                  <span className="truncate">{source.label}</span>
                </Button>
              ))}
            </nav>

            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex gap-2 border-b border-[var(--border-soft)] p-3">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--text-faint)]" />
                  <Input
                    value={query}
                    className="pl-9"
                    aria-label={t("assistant.serverFiles.search")}
                    placeholder={t("assistant.serverFiles.searchPlaceholder")}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </div>
                <Button type="button" variant="outline" onClick={loadSources}>
                  {t("assistant.serverFiles.refresh")}
                </Button>
              </div>

              <div className="min-h-64 flex-1 overflow-auto p-2 sm:min-h-80">
                {activeSource?.error ? (
                  <p className="px-3 py-8 text-sm text-[var(--warning)]">
                    {t("assistant.serverFiles.sourceTooLarge")}
                  </p>
                ) : visibleTree.length === 0 ? (
                  <p className="px-3 py-8 text-sm text-[var(--text-mut)]">
                    {t(query ? "assistant.serverFiles.noResults" : "assistant.serverFiles.empty")}
                  </p>
                ) : (
                  <ul aria-label={t("assistant.serverFiles.filesLabel")}>
                    {visibleTree.map((node) => (
                      <TreeRow
                        key={node.path}
                        node={node}
                        fullNode={activeTree.find((item) => item.path === node.path)}
                        depth={0}
                        selected={activeSelected}
                        expanded={activeExpanded}
                        forceExpanded={query.trim().length > 0}
                        onToggleSelection={toggleSelection}
                        onToggleExpanded={toggleExpanded}
                      />
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="border-t border-[var(--border-soft)] px-5 py-4">
          <div className="mb-3 flex items-start justify-between gap-4 text-sm">
            <p
              className={
                overLimit || fileTooLarge ? "text-[var(--danger)]" : "text-[var(--text-mut)]"
              }
              aria-live="polite"
            >
              {overLimit
                ? t("assistant.serverFiles.overLimit")
                : fileTooLarge
                  ? t("assistant.serverFiles.fileTooLarge")
                  : t("assistant.serverFiles.summary", {
                      count: total.count,
                      size: formatBytes(total.bytes),
                    })}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={closeDialog}>
              {t("assistant.serverFiles.cancel")}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={total.count === 0 || overLimit || fileTooLarge}
              onClick={attachSelection}
            >
              {t("assistant.serverFiles.attach")}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
