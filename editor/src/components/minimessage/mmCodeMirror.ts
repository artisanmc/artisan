import type { Segment, Style } from "@/lib/miniMessage";
import { parseMiniMessageSource } from "@/lib/miniMessage";
import { deleteVisible, diffText, splitLine } from "@/lib/mm/edit";
import { type RichLayout, insertionPoint, richLayout } from "@/lib/mm/layout";
import { type MmProfile, diagnose, lineCap, lineCount } from "@/lib/mm/profiles";
import { markupTokens } from "@/lib/mm/tree";
import type { PlaceholderEntry } from "@/lib/placeholderCatalog";
import { type CompletionContext, autocompletion } from "@codemirror/autocomplete";
import {
  Annotation,
  EditorState,
  type Extension,
  Prec,
  type Range,
  StateField,
  Transaction,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType, keymap } from "@codemirror/view";

/**
 * The CodeMirror side of the rich MiniMessage editor. One document — the MiniMessage
 * source — and two views of it:
 *  - rich: markup hidden (atomic ranges), text styled as in game; typing and deleting
 *    only touch visible characters, so tags stay balanced;
 *  - code: the raw source, tags highlighted.
 * Both flag what the profile does not allow.
 */
export type MmViewMode = "rich" | "code";

/** Marks a transaction the rich view built itself: the input filter lets it through. */
export const mmInternal = Annotation.define<boolean>();

const perLineOf = (profile: MmProfile) => profile.lines === "separate";

export function styleCss(style: Style): string {
  const parts: string[] = [];
  if (style.color) parts.push(`color:${style.color}`);
  if (style.bold === true) parts.push("font-weight:700");
  if (style.bold === false) parts.push("font-weight:400");
  if (style.italic === true) parts.push("font-style:italic");
  if (style.italic === false) parts.push("font-style:normal");
  const lines: string[] = [];
  if (style.underlined) lines.push("underline");
  if (style.strikethrough) lines.push("line-through");
  if (style.interactive && !style.underlined) lines.push("underline");
  if (lines.length) parts.push(`text-decoration-line:${lines.join(" ")}`);
  if (style.interactive) parts.push("text-decoration-style:dotted");
  return parts.join(";");
}

class GeneratedWidget extends WidgetType {
  constructor(
    readonly segments: Segment[],
    readonly raw: string,
  ) {
    super();
  }
  eq(other: GeneratedWidget) {
    return other.raw === this.raw && other.segments.length === this.segments.length;
  }
  toDOM() {
    const wrap = document.createElement("span");
    wrap.className = "cm-mm-chip";
    wrap.title = this.raw;
    const text = this.segments.map((s) => s.text).join("");
    if (text === "\n") {
      wrap.textContent = "↵";
      return wrap;
    }
    for (const seg of this.segments) {
      const span = document.createElement("span");
      span.setAttribute("style", styleCss(seg.style));
      span.textContent = seg.text;
      wrap.appendChild(span);
    }
    return wrap;
  }
  ignoreEvent() {
    return false;
  }
}

const PLACEHOLDER = /\{[^{}\s]+\}|%[A-Za-z0-9_]+%/g;

function placeholderMarks(src: string): Range<Decoration>[] {
  const out: Range<Decoration>[] = [];
  for (const m of src.matchAll(PLACEHOLDER)) {
    out.push(Decoration.mark({ class: "cm-mm-ph" }).range(m.index!, m.index! + m[0].length));
  }
  return out;
}

function diagnosticMarks(src: string, profile: MmProfile): Range<Decoration>[] {
  return diagnose(src, profile)
    .filter((d) => d.to > d.from)
    .map((d) => Decoration.mark({ class: "cm-mm-warn" }).range(d.from, d.to));
}

interface RichState {
  layout: RichLayout;
  decorations: DecorationSet;
  atomic: DecorationSet;
}

function buildRich(state: EditorState, profile: MmProfile): RichState {
  const src = state.doc.toString();
  const layout = richLayout(src, perLineOf(profile));
  const deco: Range<Decoration>[] = [];
  const atomic: Range<Decoration>[] = [];
  for (const m of layout.marks) {
    const css = styleCss(m.style);
    const obf = m.style.obfuscated ? " cm-mm-obf" : "";
    if (css || obf)
      deco.push(
        Decoration.mark({ attributes: { style: css }, class: obf.trim() || undefined }).range(
          m.from,
          m.to,
        ),
      );
  }
  for (const h of layout.hidden) {
    const r = Decoration.replace({}).range(h.from, h.to);
    deco.push(r);
    atomic.push(r);
  }
  for (const w of layout.widgets) {
    const r = Decoration.replace({
      widget: new GeneratedWidget(w.segments, src.slice(w.from, w.to)),
    }).range(w.from, w.to);
    deco.push(r);
    atomic.push(r);
  }
  deco.push(...placeholderMarks(src));
  return {
    layout,
    decorations: Decoration.set(deco, true),
    atomic: Decoration.set(atomic, true),
  };
}

function richField(profile: MmProfile) {
  return StateField.define<RichState>({
    create: (state) => buildRich(state, profile),
    update: (value, tr) => (tr.docChanged ? buildRich(tr.state, profile) : value),
    provide: (f) => [
      EditorView.decorations.from(f, (v) => v.decorations),
      EditorView.atomicRanges.of((view) => view.state.field(f).atomic),
    ],
  });
}

/** Rewrites typing and deleting so they only touch visible characters. */
function richInputFilter(profile: MmProfile) {
  const perLine = perLineOf(profile);
  return EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged || tr.annotation(mmInternal)) return tr;
    if (!(tr.isUserEvent("input") || tr.isUserEvent("delete"))) return tr;
    const changes: { from: number; to: number; insert: string }[] = [];
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      changes.push({ from: fromA, to: toA, insert: inserted.toString() });
    });
    if (changes.length !== 1) return tr;
    const { from, to } = changes[0]!;
    let insert = changes[0]!.insert;
    if (profile.lines === "single") insert = insert.replace(/\r?\n/g, " ");
    const src = tr.startState.doc.toString();
    let text = src;
    let caret = from;
    if (to > from) ({ text, caret } = deleteVisible(src, from, to, perLine));
    if (insert) {
      const at = to > from ? caret : insertionPoint(text, richLayout(text, perLine).units, from);
      if (perLine && insert === "\n") ({ text, caret } = splitLine(text, at));
      else {
        text = text.slice(0, at) + insert + text.slice(at);
        caret = at + insert.length;
      }
    }
    if (text === src) return { selection: { anchor: caret } };
    // No new line past the profile's cap, whether from Enter, a paste or a typed `<newline>`.
    const cap = lineCap(profile);
    if (cap !== undefined) {
      const lines = lineCount(text, profile);
      if (lines > cap && lines > lineCount(src, profile)) return [];
    }
    return {
      changes: diffText(src, text),
      selection: { anchor: caret },
      annotations: [
        mmInternal.of(true),
        Transaction.userEvent.of(tr.annotation(Transaction.userEvent) ?? "input"),
      ],
      scrollIntoView: true,
    };
  });
}

/** Backspace and Delete remove one visible character, never a tag. */
function richKeymap(field: StateField<RichState>) {
  const remove = (view: EditorView, backward: boolean) => {
    const sel = view.state.selection.main;
    if (!sel.empty) return false;
    const units = view.state.field(field).layout.units;
    const unit = backward
      ? [...units].reverse().find((u) => u.to <= sel.head)
      : units.find((u) => u.from >= sel.head);
    if (unit) {
      view.dispatch({
        changes: { from: unit.from, to: unit.to },
        userEvent: backward ? "delete.backward" : "delete.forward",
      });
    }
    return true;
  };
  return Prec.highest(
    keymap.of([
      { key: "Backspace", run: (v) => remove(v, true) },
      { key: "Delete", run: (v) => remove(v, false) },
    ]),
  );
}

function codeField(profile: MmProfile) {
  const build = (state: EditorState): DecorationSet => {
    const src = state.doc.toString();
    const segs = parseMiniMessageSource(src, perLineOf(profile));
    const deco: Range<Decoration>[] = markupTokens(src, segs).map((t) =>
      Decoration.mark({ class: "cm-mm-tag" }).range(t.from, t.to),
    );
    deco.push(...placeholderMarks(src), ...diagnosticMarks(src, profile));
    return Decoration.set(deco, true);
  };
  return StateField.define<DecorationSet>({
    create: build,
    update: (value, tr) => (tr.docChanged ? build(tr.state) : value),
    provide: (f) => EditorView.decorations.from(f),
  });
}

function placeholderCompletion(entries: PlaceholderEntry[]) {
  return (ctx: CompletionContext) => {
    const word = ctx.matchBefore(/\{[\w.]*$/);
    if (!word || entries.length === 0) return null;
    return {
      from: word.from,
      options: entries.map((e) => ({
        label: `{${e.path}}`,
        detail: e.sample ?? e.type,
        apply: `{${e.path}}`,
      })),
      validFor: /^\{[\w.]*$/,
    };
  };
}

export const MM_THEME = EditorView.theme({
  "&": { fontSize: "13px", background: "transparent" },
  "&.cm-focused": { outline: "none" },
  ".cm-content": { padding: "8px 0", fontFamily: "var(--font-mono)", caretColor: "var(--text)" },
  ".cm-line": { padding: "0 10px" },
  ".cm-cursor": { borderLeftColor: "var(--text)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    background: "var(--brand-soft) !important",
  },
  ".cm-mm-tag": { color: "var(--text-faint)" },
  ".cm-mm-ph": {
    borderRadius: "4px",
    boxShadow: "inset 0 0 0 1px var(--brand-line)",
  },
  ".cm-mm-warn": {
    textDecoration: "underline wavy var(--warning)",
    textUnderlineOffset: "3px",
  },
  ".cm-mm-chip": {
    padding: "0 3px",
    borderRadius: "4px",
    background: "var(--surface-hover)",
    color: "var(--text-mut)",
  },
  ".cm-mm-obf": { textDecoration: "underline dashed", textDecorationColor: "var(--text-faint)" },
});

export interface MmExtensionOptions {
  mode: MmViewMode;
  profile: MmProfile;
  entries: PlaceholderEntry[];
}

export function mmExtensions({ mode, profile, entries }: MmExtensionOptions): Extension[] {
  const exts: Extension[] = [MM_THEME, EditorView.lineWrapping];
  if (profile.lines === "single") {
    exts.push(Prec.highest(keymap.of([{ key: "Enter", run: () => true }])));
  }
  if (entries.length) exts.push(autocompletion({ override: [placeholderCompletion(entries)] }));
  if (mode === "rich") {
    const field = richField(profile);
    exts.push(field, richInputFilter(profile), richKeymap(field));
  } else exts.push(codeField(profile));
  return exts;
}
