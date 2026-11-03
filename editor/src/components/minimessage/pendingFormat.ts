import { type MmEditResult, diffText } from "@/lib/mm/edit";
import {
  EditorState,
  type Extension,
  Prec,
  StateEffect,
  StateField,
  Transaction,
} from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { mmInternal } from "./mmCodeMirror";

/** An operation of `lib/mm/edit`, bound to everything but the text and the range. */
export type MmOp = (src: string, from: number, to: number, perLine: boolean) => MmEditResult | null;

/**
 * A format chosen with nothing selected: kept until the next typed text, which it then
 * formats (bold on, then type → bold text), as in a word processor.
 *  - `key` groups what replaces itself: one color (`color`), one style, one click…
 *  - `toggle`: chosen again, it is dropped (bold twice = nothing pending).
 */
export interface PendingFormat {
  key: string;
  op: MmOp;
  toggle?: boolean;
}

const setPending = StateEffect.define<PendingFormat[]>();

/** What the next typed text will get. Lost once the caret moves or the text changes otherwise. */
export const pendingFormat = StateField.define<PendingFormat[]>({
  create: () => [],
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setPending)) return e.value;
    if (value.length === 0) return value;
    if (tr.docChanged) return [];
    if (tr.selection && !tr.selection.main.eq(tr.startState.selection.main)) return [];
    return value;
  },
});

/** Adds `entry` to what is pending: replaces one of the same key, or drops it when it toggles. */
export function addPending(view: EditorView, entry: PendingFormat): void {
  const current = view.state.field(pendingFormat, false) ?? [];
  const same = current.find((p) => p.key === entry.key);
  const others = current.filter((p) => p.key !== entry.key);
  // Clearing the formatting also drops what was chosen before it.
  const next =
    entry.key === "clear"
      ? [entry]
      : same && entry.toggle
        ? others
        : [...others.filter((p) => p.key !== "clear"), entry];
  view.dispatch({ effects: setPending.of(next) });
}

/** Pending decorations as toggles: `bold` pending flips what the caret would inherit. */
export const pendingToggles = (pending: PendingFormat[]): Set<string> =>
  new Set(pending.filter((p) => p.toggle).map((p) => p.key));

/**
 * Formats typed or pasted text with what is pending, in the same transaction (one undo
 * step). Runs after the rich view's input filter (higher precedence = later), so it sees
 * where the text really went. The caret ends inside the new markup: what is typed next
 * keeps the format.
 */
export function pendingFormatFilter(perLine: boolean): Extension {
  return Prec.highest(
    EditorState.transactionFilter.of((tr) => {
      const pending = tr.startState.field(pendingFormat, false);
      if (!pending?.length || !tr.docChanged) return tr;
      if (!(tr.isUserEvent("input.type") || tr.isUserEvent("input.paste"))) return tr;
      const start = tr.startState.doc.toString();
      const next = tr.newDoc.toString();
      const head = tr.newSelection.main.head;
      const from = head - (next.length - start.length);
      // Only a plain insertion before the caret (a split lore line is not one).
      if (from < 0 || from >= head || next.slice(0, from) + next.slice(head) !== start) return tr;
      let text = next;
      let sel = { from, to: head };
      for (const p of pending) {
        const res = p.op(text, sel.from, sel.to, perLine);
        if (res) {
          text = res.text;
          sel = res.selection;
        }
      }
      // The text changed: the field drops what was pending.
      if (text === next) return tr;
      return {
        changes: diffText(start, text),
        selection: { anchor: sel.to },
        effects: setPending.of([]),
        annotations: [
          mmInternal.of(true),
          Transaction.userEvent.of(tr.annotation(Transaction.userEvent) ?? "input.type"),
        ],
        scrollIntoView: true,
      };
    }),
  );
}
