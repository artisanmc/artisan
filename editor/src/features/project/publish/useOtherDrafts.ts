import { ApiError } from "@/lib/api/client";
import { useCallback, useRef, useState } from "react";
import {
  type OtherDeployResult,
  type OtherDraft,
  checkOtherDraft,
  loadOtherDrafts,
  publishOtherDraft,
} from "./otherDrafts";
import type { DocumentChecks } from "./publishFlow";

export type OtherDrafts =
  | { status: "loading" }
  | { status: "failed"; code: string }
  | {
      status: "ready";
      drafts: OtherDraft[];
      selected: string[];
      checks: Record<string, DocumentChecks>;
    };

/** How a multi-Project deployment ended: what went out, what failed, what was not tried. */
export interface OtherDeployReport {
  deployed: OtherDraft[];
  failed?: { draft: OtherDraft; code: string };
  skipped: OtherDraft[];
}

/**
 * The other Projects' drafts in the Deploy review: loaded when it opens, picked one per Project,
 * checked by the server as they are picked, and published one after the other.
 */
export function useOtherDrafts() {
  const [state, setState] = useState<OtherDrafts | null>(null);
  // A review opened again drops the answers of the previous one.
  const generation = useRef(0);

  const check = useCallback((draft: OtherDraft, run: number) => {
    const settle = (documents: DocumentChecks) =>
      setState((s) =>
        run !== generation.current || s?.status !== "ready"
          ? s
          : { ...s, checks: { ...s.checks, [draft.draftId]: documents } },
      );
    settle({ status: "pending" });
    void checkOtherDraft(draft).then(
      (problems) => settle({ status: "ready", problems }),
      (error) =>
        settle({
          status: "unavailable",
          code: error instanceof ApiError ? error.code : "unknown_error",
        }),
    );
  }, []);

  /** Loads the drafts; [preselect] are picked (and checked) at once, one per Project. */
  const load = useCallback(
    (skipDraftId: string | undefined, preselect: string[] = []) => {
      const run = ++generation.current;
      setState({ status: "loading" });
      void loadOtherDrafts(skipDraftId).then(
        (drafts) => {
          if (run !== generation.current) return;
          const selected: string[] = [];
          for (const draft of drafts)
            if (
              preselect.includes(draft.draftId) &&
              !draft.unsynced &&
              !selected.some(
                (id) => drafts.find((d) => d.draftId === id)?.projectId === draft.projectId,
              )
            )
              selected.push(draft.draftId);
          setState({ status: "ready", drafts, selected, checks: {} });
          for (const draft of drafts) if (selected.includes(draft.draftId)) check(draft, run);
        },
        (error) => {
          if (run !== generation.current) return;
          setState({
            status: "failed",
            code: error instanceof ApiError ? error.code : "unknown_error",
          });
        },
      );
    },
    [check],
  );

  /** Picks or unpicks a draft; picking one unpicks the other drafts of its Project. */
  const toggle = useCallback(
    (draftId: string) => {
      setState((s) => {
        if (s?.status !== "ready") return s;
        const draft = s.drafts.find((d) => d.draftId === draftId);
        if (!draft || draft.unsynced) return s;
        if (s.selected.includes(draftId))
          return { ...s, selected: s.selected.filter((id) => id !== draftId) };
        const sameProject = new Set(
          s.drafts.filter((d) => d.projectId === draft.projectId).map((d) => d.draftId),
        );
        if (!s.checks[draftId]) queueMicrotask(() => check(draft, generation.current));
        return { ...s, selected: [...s.selected.filter((id) => !sameProject.has(id)), draftId] };
      });
    },
    [check],
  );

  /** Unpicks every draft of [projectId] (the open Project's working copy was picked instead). */
  const unselectProject = useCallback((projectId: string) => {
    setState((s) =>
      s?.status !== "ready"
        ? s
        : {
            ...s,
            selected: s.selected.filter(
              (id) => s.drafts.find((d) => d.draftId === id)?.projectId !== projectId,
            ),
          },
    );
  }, []);

  const close = useCallback(() => {
    generation.current++;
    setState(null);
  }, []);

  return { state, load, toggle, unselectProject, close, check };
}

/** The picked drafts, in the review's order. */
export function selectedDrafts(state: OtherDrafts | null): OtherDraft[] {
  if (state?.status !== "ready") return [];
  return state.drafts.filter((d) => state.selected.includes(d.draftId));
}

/** Publishes [drafts] one after the other and stops at the first failure. */
export async function deployOtherDrafts(
  drafts: OtherDraft[],
  publish: (draft: OtherDraft) => Promise<OtherDeployResult> = publishOtherDraft,
): Promise<OtherDeployReport> {
  const deployed: OtherDraft[] = [];
  for (const [index, draft] of drafts.entries()) {
    const result = await publish(draft);
    if (!result.ok)
      return { deployed, failed: { draft, code: result.code }, skipped: drafts.slice(index + 1) };
    deployed.push(draft);
  }
  return { deployed, skipped: [] };
}
