import { yaml as yamlLang } from "@codemirror/lang-yaml";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";

/**
 * Shared YAML code editor — syntax highlighting, line numbers, folding, and the
 * indentation behaviour you expect from a code editor (Enter keeps the current
 * indent, Tab indents the selection).
 *
 * One definition for every YAML surface: the Translation panel's raw view and
 * the Config screens' YAML tab (ADR `yaml-assisted-editing` ⑦).
 */
export const YAML_CM_THEME = EditorView.theme({
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

export function YamlCodeEditor({
  value,
  onChange,
  ariaLabel,
  height = "100%",
  autoFocus = false,
  readOnly = false,
}: {
  value: string;
  /** Optional when [readOnly] — a viewer has nothing to report. */
  onChange?: (next: string) => void;
  /** Names the editor for assistive tech and for tests (usually the file path). */
  ariaLabel: string;
  height?: string;
  autoFocus?: boolean;
  /**
   * Viewer mode: same highlighting, gutters and folding, but the content cannot be
   * edited. Used to read structured data (data-source preview rows) rather than to
   * author a file. Selection and copy stay available.
   */
  readOnly?: boolean;
}) {
  return (
    <CodeMirror
      value={value}
      extensions={[yamlLang(), YAML_CM_THEME]}
      onChange={onChange}
      editable={!readOnly}
      theme="dark"
      autoFocus={autoFocus}
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        autocompletion: false,
        highlightActiveLine: true,
        // Keeps the block's indentation on Enter and indents with Tab.
        indentOnInput: true,
        tabSize: 2,
      }}
      aria-label={ariaLabel}
      className="bg-[var(--surface)] text-[var(--text)]"
      style={{ height }}
    />
  );
}
