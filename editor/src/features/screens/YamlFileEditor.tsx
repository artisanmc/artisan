import { parse } from "yaml";
import { YamlCodeEditor } from "@/components/ui/yaml-code-editor";
import { useTranslation } from "react-i18next";
import type { ConfigFile } from "@/lib/api/configScreens";
import { FileHistory } from "@/features/project/FileHistory";

/** Parse failure of one edited file: the message and, when known, the line. */
export interface YamlSyntaxError {
  path: string;
  message: string;
  line: number | null;
}

/**
 * Syntax check of an edited file set (ADR `yaml-assisted-editing` ⑦): the form
 * needs valid YAML to exist, the text tab never does — a broken file stays
 * editable and stays saveable, because it is the admin's file.
 */
export function yamlErrorsOf(files: ConfigFile[]): YamlSyntaxError[] {
  const out: YamlSyntaxError[] = [];
  for (const f of files) {
    try {
      parse(f.content);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const m = /at line (\d+)/.exec(msg);
      out.push({ path: f.path, message: msg.split("\n")[0] ?? msg, line: m ? Number(m[1]) : null });
    }
  }
  return out;
}

/**
 * Raw YAML editing of a file set — the same files the generated form edits.
 * Saving canonicalizes (the text goes through parse → domain → writer), so what
 * comes back may be reformatted; comments come from the schema, never from here.
 */
export function YamlFileEditor({
  files,
  onChange,
  errors,
  selected,
  onSelect,
  history,
}: {
  files: ConfigFile[];
  onChange: (path: string, content: string) => void;
  errors: YamlSyntaxError[];
  selected: string;
  onSelect: (path: string) => void;
  /** Corbeille du fichier — absente quand le contexte serveur est inconnu. */
  history?: { networkId: string; serverId: string; diskId: string };
}) {
  const { t } = useTranslation();
  const current = files.find((f) => f.path === selected) ?? files[0];
  const error = errors.find((e) => e.path === current?.path);

  if (!current) return <p className="text-[12px] text-[var(--text-faint)]">{t("screens.emptyTable")}</p>;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" data-testid="yaml-editor">
      {files.length > 1 && (
        <select
          className="input h-7 w-auto max-w-full self-start px-2 font-mono text-[11px]"
          value={current.path}
          onChange={(e) => onSelect(e.target.value)}
          aria-label={t("screens.yamlFile")}
        >
          {files.map((f) => (
            <option key={f.path} value={f.path}>
              {f.path}
            </option>
          ))}
        </select>
      )}
      <div className="min-h-64 flex-1 overflow-auto rounded border border-[var(--border-soft)] bg-[var(--surface)]">
        <YamlCodeEditor
          value={current.content}
          ariaLabel={current.path}
          onChange={(next) => onChange(current.path, next)}
        />
      </div>
      {error && (
        <p className="text-[11px] text-rose-300" role="alert">
          {error.line !== null ? `${t("screens.yamlErrorLine", { line: error.line })} — ` : ""}
          {error.message}
        </p>
      )}
      {history ? (
        <FileHistory
          key={current.path}
          networkId={history.networkId}
          serverId={history.serverId}
          diskId={history.diskId}
          path={current.path}
          onRestore={(content) => onChange(current.path, content)}
        />
      ) : null}
    </div>
  );
}
