import { copyText } from "@/lib/clipboard";
import { cx } from "@/lib/cx";
import { type Decoration, diffText, rangeHas, toggleDecoration } from "@/lib/mm/edit";
import { hasLegacyCodes, legacyToMiniMessage } from "@/lib/mm/legacy";
import type { Palette } from "@/lib/mm/palettes";
import { type MmProfile, diagnose } from "@/lib/mm/profiles";
import type { PlaceholderEntry } from "@/lib/placeholderCatalog";
import { Prec } from "@codemirror/state";
import { type EditorView, keymap } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type MmOp, MmToolbar } from "./MmToolbar";
import { type MmViewMode, mmExtensions, mmInternal } from "./mmCodeMirror";
import { usePaletteLibrary } from "./usePaletteLibrary";

export interface MmEditorProps {
  value: string;
  onChange: (value: string) => void;
  profile: MmProfile;
  /** Placeholders offered after `{`. */
  entries?: PlaceholderEntry[];
  /** Palettes offered by the toolbar; defaults to the library's. */
  palettes?: Palette[];
  /** Starting view; the user switches with the toolbar. */
  initialMode?: MmViewMode;
  minHeight?: string;
  /** Shown while the text is empty. */
  placeholder?: string;
  /** A lore's `lore_max_width`: where each line will wrap is marked, nothing is written. */
  wrapWidth?: number;
  /** Called when the editor, toolbar included, takes the focus. */
  onFocus?: () => void;
  "aria-label"?: string;
  className?: string;
}

const NO_ENTRIES: PlaceholderEntry[] = [];
const DECOS: Decoration[] = ["bold", "italic", "underlined", "strikethrough", "obfuscated"];

/**
 * The rich MiniMessage input: toolbar, rich or code view of the same source, and what
 * the profile flags. Controlled: `value` is the MiniMessage text, never rewritten
 * unless the user edits it.
 */
export function MmEditor({
  value,
  onChange,
  profile,
  entries = NO_ENTRIES,
  palettes,
  initialMode = "rich",
  minHeight = "64px",
  placeholder,
  wrapWidth,
  onFocus,
  "aria-label": ariaLabel,
  className,
}: MmEditorProps) {
  const { t } = useTranslation();
  const library = usePaletteLibrary();
  const [mode, setMode] = useState<MmViewMode>(initialMode);
  const [sel, setSel] = useState({ from: 0, to: 0 });
  const viewRef = useRef<EditorView | null>(null);
  const perLine = profile.lines === "separate";

  const apply = (op: MmOp) => {
    const view = viewRef.current;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    if (from === to) return;
    const src = view.state.doc.toString();
    const res = op(src, from, to, perLine);
    if (!res || res.text === src) return;
    view.dispatch({
      changes: diffText(src, res.text),
      selection: { anchor: res.selection.from, head: res.selection.to },
      annotations: mmInternal.of(true),
      userEvent: "input.format",
    });
    view.focus();
  };
  const applyRef = useRef(apply);
  applyRef.current = apply;

  const extensions = useMemo(() => {
    const shortcut = (deco: Decoration) => () => {
      applyRef.current((s, f, to, pl) => toggleDecoration(s, f, to, deco, pl));
      return true;
    };
    return [
      ...mmExtensions({
        mode,
        profile,
        entries,
        wrapWidth,
        wrapLabel: t("mmEditor.wrapMarker", { width: wrapWidth }),
      }),
      Prec.high(
        keymap.of([
          { key: "Mod-b", run: shortcut("bold") },
          { key: "Mod-i", run: shortcut("italic") },
          { key: "Mod-u", run: shortcut("underlined") },
        ]),
      ),
    ];
  }, [mode, profile, entries, wrapWidth, t]);

  const active = useMemo(() => {
    if (sel.from === sel.to) return {};
    return Object.fromEntries(
      DECOS.map((d) => [d, rangeHas(value, sel.from, sel.to, (s) => s[d] === true, perLine)]),
    );
  }, [value, sel, perLine]);

  const diagnostics = useMemo(() => diagnose(value, profile), [value, profile]);
  // A selection of hidden markup only has nothing to format.
  const hasSelection = useMemo(
    () => sel.from !== sel.to && rangeHas(value, sel.from, sel.to, () => true, perLine),
    [value, sel, perLine],
  );

  return (
    <div
      onFocus={onFocus}
      className={cx(
        "overflow-hidden rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--surface-inset)] focus-within:border-[var(--brand-line)]",
        className,
      )}
    >
      <MmToolbar
        profile={profile}
        palettes={palettes ?? library}
        mode={mode}
        onModeChange={setMode}
        hasSelection={hasSelection}
        active={active}
        onOp={apply}
        onConvertLegacy={
          hasLegacyCodes(value) ? () => onChange(legacyToMiniMessage(value)) : undefined
        }
        onCopy={() => copyText(value)}
      />
      <div
        style={{
          background: mode === "rich" ? "var(--mc-chat-bg)" : undefined,
          color: mode === "rich" ? profile.defaults.color : "var(--text)",
          fontStyle: mode === "rich" && profile.defaults.italic ? "italic" : undefined,
        }}
      >
        <CodeMirror
          value={value}
          onChange={onChange}
          extensions={extensions}
          theme="none"
          placeholder={placeholder}
          basicSetup={{
            lineNumbers: false,
            foldGutter: false,
            highlightActiveLine: false,
            highlightActiveLineGutter: false,
            autocompletion: false,
            bracketMatching: false,
            closeBrackets: false,
            indentOnInput: false,
            searchKeymap: false,
          }}
          onCreateEditor={(view) => {
            viewRef.current = view;
          }}
          onUpdate={(update) => {
            if (update.selectionSet || update.docChanged) {
              const { from, to } = update.state.selection.main;
              setSel((prev) => (prev.from === from && prev.to === to ? prev : { from, to }));
            }
          }}
          aria-label={ariaLabel ?? t("mmEditor.editorLabel")}
          style={{ minHeight }}
          minHeight={minHeight}
        />
      </div>
      {diagnostics.length > 0 && (
        <ul className="flex flex-col gap-0.5 border-[var(--border-soft)] border-t px-2.5 py-1.5 text-[11.5px] text-[var(--warning)]">
          {diagnostics.map((d) => (
            <li key={`${d.from}-${d.code}`}>
              {d.code === "feature"
                ? t("mmEditor.diagnostics.feature", {
                    feature: t(`mmEditor.features.${d.feature}`),
                  })
                : t("mmEditor.diagnostics.lines", {
                    count: profile.lines === "single" ? 1 : (profile.maxLines ?? 1),
                  })}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
