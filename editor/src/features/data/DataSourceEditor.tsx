import type { DataSource, ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { yaml as yamlLang } from "@codemirror/lang-yaml";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { stringify, parse as parseYaml } from "yaml";
import { inferFieldTypeFromValue, summarizeFieldType } from "./helpers";
import { ItemTemplatesSection, packSourceToTemplatable } from "./ItemTemplatesSection";

interface DataSourceEditorProps {
  projectId: ProjectId;
  source: DataSource;
}

const CM_THEME = EditorView.theme({
  "&": { background: "transparent", fontSize: "12px" },
  ".cm-content": { padding: "8px 0", fontFamily: "ui-monospace, monospace" },
  ".cm-line": { padding: "0 12px" },
  ".cm-gutters": {
    background: "#18181b",
    border: "none",
    color: "#52525b",
    minWidth: "32px",
  },
  ".cm-activeLineGutter": { background: "#27272a" },
  ".cm-activeLine": { background: "#27272a40" },
  ".cm-cursor": { borderLeftColor: "#a1a1aa" },
  ".cm-selectionBackground": { background: "#3f3f4660 !important" },
  "&.cm-focused .cm-selectionBackground": { background: "#3f3f4680 !important" },
  ".cm-foldPlaceholder": { background: "#3f3f46", border: "none", color: "#a1a1aa" },
});

function valueToYaml(value: unknown): string {
  if (value === undefined || value === null) return "";
  return stringify(value, { lineWidth: 0 });
}

export function DataSourceEditor({ projectId, source }: DataSourceEditorProps) {
  const { t } = useTranslation();
  const renameDataSource = useAccountStore((s) => s.renameProjectDataSource);
  const removeDataSource = useAccountStore((s) => s.removeProjectDataSource);
  const setYaml = useAccountStore((s) => s.setProjectDataSourceYaml);

  const [localYaml, setLocalYaml] = useState(() => valueToYaml(source.value));
  const [parseError, setParseError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync when the selected source changes (different source ID)
  const prevIdRef = useRef(source.id);
  useEffect(() => {
    if (prevIdRef.current !== source.id) {
      prevIdRef.current = source.id;
      setLocalYaml(valueToYaml(source.value));
      setParseError(null);
    }
  }, [source.id, source.value]);

  const handleChange = useCallback(
    (val: string) => {
      setLocalYaml(val);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        try {
          parseYaml(val);
          setParseError(null);
          setYaml({ projectId, id: source.id, yaml: val });
        } catch (e) {
          setParseError(e instanceof Error ? e.message : String(e));
        }
      }, 400);
    },
    [projectId, source.id, setYaml],
  );

  const inferredType = (() => {
    try {
      const parsed = parseYaml(localYaml);
      return summarizeFieldType(inferFieldTypeFromValue(parsed ?? []));
    } catch {
      return null;
    }
  })();

  return (
    <div className="flex h-full flex-col gap-3">
      <header className="flex shrink-0 items-center justify-between gap-2">
        <input
          type="text"
          value={source.name}
          onChange={(e) => renameDataSource({ projectId, id: source.id, newName: e.target.value })}
          className="min-w-0 flex-1 bg-transparent text-lg font-semibold text-[var(--text)] outline-none focus:border-b focus:border-[var(--brand-line)]"
        />
        <button
          type="button"
          onClick={() => removeDataSource({ projectId, id: source.id })}
          className="shrink-0 rounded px-2 py-1 text-[11px] text-[var(--text-faint)] hover:bg-[var(--surface-raised-2)] hover:text-rose-300"
        >
          {t("dataSources.remove")}
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-[var(--border-soft)]">
        <CodeMirror
          value={localYaml}
          extensions={[yamlLang(), CM_THEME]}
          onChange={handleChange}
          theme="dark"
          basicSetup={{
            lineNumbers: true,
            foldGutter: true,
            autocompletion: false,
            highlightActiveLine: true,
            indentOnInput: true,
            bracketMatching: true,
          }}
          className="min-h-0 flex-1 overflow-auto bg-[var(--surface-raised)] text-[var(--text)]"
          style={{ height: "100%" }}
        />
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2">
        {parseError ? (
          <span className="font-mono text-[11px] text-rose-400">{parseError}</span>
        ) : (
          <span className="font-mono text-[11px] text-[var(--text-faint)]">
            {inferredType ?? "—"}
          </span>
        )}
      </div>

      {/* Item sets over PROJECT data — same tooling as server sources. */}
      <div className="shrink-0 border-t border-[var(--border-soft)] pt-2">
        <ItemTemplatesSection projectId={projectId} source={packSourceToTemplatable(source)} />
      </div>
    </div>
  );
}
