/**
 * The publish workflow of a Project: deploy (the only gesture that writes the
 * server's disk, compare-and-swap — ADR `server-disk-only-storage`), its diff
 * review, the three conflict sources and the explicit draft save.
 *
 * A conflict opens the resolution modal; nothing has been written at that
 * point (the plugin applies all or nothing), and no file is decided without an
 * explicit choice from the admin.
 *
 * `SaveControls` only renders what this hook returns; the state transitions
 * live in `publishReducer` (pure).
 */
import type { ProjectId } from "@/domain/types";
import { OPEN_DEPLOY_REVIEW } from "@/features/project/ProjectHistory";
import { hasDraftChanges } from "@/features/project/draft";
import { flushDraftEdits } from "@/features/project/draftFlush";
import {
  consumeOpenConflicts,
  discardPersistedDraft,
  markDraftPending,
  resolveDraftConflict,
  syncPersistedDraft,
  usePersistedDraftStore,
} from "@/features/project/persistedDrafts";
import { type ConflictChoice, applyResolutions } from "@/features/project/resolveConflicts";
import { rebuildServerPackInBackground } from "@/features/project/resourcePackSync";
import {
  adoptDiskIntoProject,
  projectTree,
  saveProjectToDisk,
} from "@/features/project/saveProjectToDisk";
import { serverChecksFor } from "@/features/serverIndex/serverChecks";
import { useServerIndexStore } from "@/features/serverIndex/serverIndexStore";
import { ApiError } from "@/lib/api/client";
import { checkDocuments, deploymentDelta } from "@/lib/api/documentChecks";
import { useProjectPrincipalId } from "@/lib/projectPrincipal";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { useProjectsStore } from "@/state/projectsStore";
import { useEffect, useReducer, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { formatSaveError, initialPublishState, publishReducer } from "./publishFlow";
import { deployDraftsAndReport } from "./deployDrafts";
import { selectedDrafts, useOtherDrafts } from "./useOtherDrafts";

/**
 * Realigns the displayed Project with the draft after a conflict resolution:
 * files taken from the other session (choice "take theirs" or updated
 * automatically) enter the editor's tree. Only paths that differ are touched,
 * never unrelated files.
 */
export function syncStoreFromDraft(projectId: ProjectId): void {
  const live = useProjectsStore.getState().openProjects.projects.find((p) => p.id === projectId);
  const draft = useProjectDraftStore.getState().get(projectId);
  if (!live || !draft) return;
  const before = projectTree(live);
  const adopt: Record<string, string> = {};
  const remove: string[] = [];
  for (const path of new Set([...Object.keys(before), ...Object.keys(draft.tree)])) {
    const next = draft.tree[path];
    if (next === undefined) remove.push(path);
    else if (next !== before[path]) adopt[path] = next;
  }
  if (Object.keys(adopt).length > 0 || remove.length > 0)
    useProjectsStore.getState().replaceProject(adoptDiskIntoProject(live, adopt, remove));
}

export function usePublishFlow(
  projectId: ProjectId,
  /** The server is offline: the draft stays editable, publishing waits for its return. */
  offline: boolean,
) {
  const { t } = useTranslation();
  const user = useProjectPrincipalId(projectId);
  const replaceProject = useProjectsStore((s) => s.replaceProject);
  // The LIVE Project, not a prop: a prop comes from a `useState` frozen at load
  // (`useProjectLoader`) while every edit lands in `useProjectsStore`. Saving the
  // prop wrote the Project as it was when opened — the whole session's work was
  // silently lost.
  const project = useProjectsStore((s) => s.openProjects.projects.find((p) => p.id === projectId));
  const [state, dispatch] = useReducer(publishReducer, initialPublishState);
  const draftSession = usePersistedDraftStore((s) => s.sessions[projectId]);

  const reportSaveError = (code: string, status?: number, message?: string) => {
    const reason = t(`save.errors.${code}`, { defaultValue: t("save.errors.unknown") });
    dispatch({ type: "saveFailed", details: formatSaveError(reason, code, status, message) });
  };

  const openConflicts = draftSession?.openConflicts;
  useEffect(() => {
    if (!project || !openConflicts?.length) return;
    consumeOpenConflicts(projectId);
    dispatch({
      type: "conflictsFound",
      source: "open",
      tree: projectTree(project),
      conflicts: openConflicts,
    });
  }, [openConflicts, project, projectId]);

  const draftConflict = draftSession?.draftConflict;
  useEffect(() => {
    if (!draftConflict) return;
    // No diverging file: the rebase is enough and is applied without a modal —
    // only the editor tree update remains.
    if (draftConflict.conflicts.length === 0) {
      void resolveDraftConflict(projectId, {})
        .then(() => syncStoreFromDraft(projectId))
        .catch(() => {});
      return;
    }
    const live = useProjectsStore.getState().openProjects.projects.find((p) => p.id === projectId);
    dispatch({
      type: "conflictsFound",
      source: "draft",
      tree: live ? projectTree(live) : {},
      conflicts: draftConflict.conflicts,
    });
  }, [draftConflict, projectId]);

  // "Do you have unsaved work?" — read from the draft, which already holds the
  // serialised tree. Recomputing it here would reserialise the whole Project on
  // EVERY topbar render. The draft lags 800 ms behind: it is an indicator, not
  // a lock.
  const draft = useProjectDraftStore((s) => (project ? s.drafts[project.id] : undefined));
  const dirty = draft ? hasDraftChanges(draft) : false;
  // Work this browser holds in other Projects: Deploy also opens for it, to publish it from here.
  const pendingElsewhere = useProjectDraftStore((s) =>
    Object.entries(s.drafts).some(([id, d]) => id !== projectId && hasDraftChanges(d)),
  );
  const canSave = Boolean(user && project);
  const others = useOtherDrafts();
  const [includeCurrent, setIncludeCurrent] = useState(true);
  const picked = selectedDrafts(others.state);
  // The open Project's working copy goes out unless a draft of the same Project was picked.
  const currentPicked =
    includeCurrent && dirty && !picked.some((other) => other.projectId === projectId);

  /**
   * Save = write the server's files. It is the only path through which an edit
   * reaches the disk (ADR `server-disk-only-storage`).
   */
  const runSave = async (): Promise<boolean> => {
    if (!project) {
      toast.info(t("deploy.cannotDeployTitle"));
      return false;
    }
    // An unresolved draft conflict is already offered by the modal: do not
    // stack a failure dialog on top of it.
    if (draftSession?.draftConflict) return false;
    dispatch({ type: "saveStarted" });
    try {
      const attemptedTree = projectTree(project);
      const res = await saveProjectToDisk(project);
      if (res.ok) {
        dispatch({ type: "saveSucceeded" });
        toast.success(res.wrote === 0 ? t("deploy.nothing") : t("deploy.deployed"));
        rebuildServerPackInBackground(t, project.serverKeyId);
        return true;
      }
      if (res.error === "conflict") {
        // Nothing was written: the plugin applies all or nothing. The admin is asked
        // to decide file by file, never on their behalf.
        dispatch({
          type: "conflictsFound",
          source: "save",
          tree: attemptedTree,
          conflicts: res.conflicts,
          diskFiles: res.diskFiles,
        });
        return false;
      }
      reportSaveError(res.code ?? res.error, res.status, res.message);
    } catch (error) {
      reportSaveError(error instanceof Error ? error.message : "unknown_error");
    } finally {
      dispatch({ type: "saveSettled" });
    }
    return false;
  };

  /** Opens the review; [preselect] picks drafts of other Projects (the assistant's). */
  const openReview = (preselect: string[] = []) => {
    if (!project) return;
    if (offline) {
      toast.error(t("deploy.offline"));
      return;
    }
    flushDraftEdits();
    const live = useProjectsStore.getState().openProjects.projects.find((p) => p.id === projectId);
    const current = useProjectDraftStore.getState().get(projectId);
    const changes = {
      before: useProjectBaselineStore.getState().get(projectId) ?? {},
      after: projectTree(live ?? project),
      renames: useProjectDraftStore.getState().pendingRenames[projectId] ?? current?.renames,
      binaryBefore: current?.binaryBaseline,
      binaryAfter: current?.binaryTree,
    };
    dispatch({
      type: "reviewOpened",
      // Checks against the other projects' published state, read at review time.
      checks: serverChecksFor(live ?? project, useServerIndexStore.getState()),
      changes,
    });
    // The other Projects' drafts, and this one's other drafts: listed under it.
    setIncludeCurrent(true);
    others.load(current?.remote?.id, preselect);
    // The check Deploy runs before writing, asked now: the problems show in the review.
    const { files, deletes } = deploymentDelta(changes.before, changes.after);
    if (Object.keys(files).length === 0 && deletes.length === 0) {
      dispatch({ type: "documentsChecked", changes, documents: { status: "ready", problems: [] } });
      return;
    }
    dispatch({ type: "documentsChecked", changes, documents: { status: "pending" } });
    void checkDocuments(projectId, files, deletes).then(
      (problems) =>
        dispatch({ type: "documentsChecked", changes, documents: { status: "ready", problems } }),
      (error) =>
        dispatch({
          type: "documentsChecked",
          changes,
          documents: {
            status: "unavailable",
            code: error instanceof ApiError ? error.code : "unknown_error",
          },
        }),
    );
  };
  // "Restore and publish" from the History tab goes through this same review.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `openReview` reads the stores when it runs.
  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId: string; preselect?: string[] }>).detail;
      if (detail?.projectId === projectId) openReview(detail.preselect);
    };
    window.addEventListener(OPEN_DEPLOY_REVIEW, onOpen);
    return () => window.removeEventListener(OPEN_DEPLOY_REVIEW, onOpen);
  }, [projectId, project]);

  /**
   * The open Project first (its conflicts open the resolution as before), then each picked draft
   * of another Project, one after the other: the first failure stops the rest. Each Project is
   * written on its own: one that went out stays out when a later one fails.
   */
  const confirmReview = async () => {
    const queue = picked;
    const withCurrent = currentPicked;
    dispatch({ type: "reviewClosed" });
    others.close();
    if (withCurrent && !(await runSave())) {
      if (queue.length > 0) toast.info(t("deploy.others.notTried", { count: queue.length }));
      return;
    }
    if (queue.length === 0) return;
    dispatch({ type: "saveStarted" });
    try {
      await deployDraftsAndReport(t, queue);
    } finally {
      dispatch({ type: "saveSettled" });
    }
  };

  const draftSaved = draftSession?.status === "saved";
  const draftBusy = state.savingDraft || draftSession?.status === "saving";
  const draftNeedsAttention =
    draftSession?.status === "conflict" ||
    draftSession?.status === "offline" ||
    draftSession?.status === "rejected" ||
    draftSession?.status === "migration_pending";

  const saveDraft = async () => {
    if (draftBusy || draftSaved) return;
    if (draftSession?.draftConflict) return;
    dispatch({ type: "draftSaveStarted" });
    try {
      flushDraftEdits();
      await syncPersistedDraft(projectId, true);
    } finally {
      dispatch({ type: "draftSaveSettled" });
    }
    const status = usePersistedDraftStore.getState().sessions[projectId]?.status;
    if (status === "saved") toast.success(t("drafts.savedToast"));
    else if (status) toast.error(t(`drafts.${status}`));
  };

  const applyConflicts = async () => {
    if (!project) return;
    const { source, conflicts, choices } = state.conflict;
    if (source === "draft") {
      try {
        await resolveDraftConflict(projectId, choices);
        syncStoreFromDraft(projectId);
        dispatch({ type: "conflictsClosed" });
        toast.info(t("save.conflictDraftResolved"));
      } catch {
        toast.error(t("drafts.failed"));
      }
      return;
    }
    const baseline = useProjectBaselineStore.getState().get(project.id) ?? {};
    const outcome = applyResolutions(baseline, conflicts, choices);
    if (outcome.unresolved.length > 0) return; // the button is already disabled
    useProjectBaselineStore.getState().set(project.id, outcome.nextBaseline);
    const adopts =
      Object.keys(outcome.adoptFromDisk).length > 0 || outcome.removeFromTree.length > 0;
    if (adopts) {
      replaceProject(adoptDiskIntoProject(project, outcome.adoptFromDisk, outcome.removeFromTree));
    }
    dispatch({ type: "conflictsClosed" });
    if (source === "open") {
      // The draft's base follows the choice; autosave keeps it.
      const local = useProjectDraftStore.getState().get(project.id);
      if (local)
        useProjectDraftStore
          .getState()
          .save(project.id, { ...local, baseline: outcome.nextBaseline });
      markDraftPending(project.id);
      toast.info(t("save.conflictOpenResolved"));
      return;
    }
    // The re-parse above has not reached this closure yet; the next render keeps
    // the Project up to date and the admin saves again. Still rerun when nothing
    // was adopted: the base is enough.
    if (!adopts) {
      await runSave();
    } else {
      toast.info(t("save.conflictAdopted"));
    }
  };

  const discardChanges = async () => {
    if (!project) return;
    try {
      await discardPersistedDraft(project.id);
      window.location.reload();
    } catch {
      toast.error(t("drafts.failed"));
    }
  };

  return {
    state,
    draftSession,
    dirty,
    canSave,
    draftSaved,
    draftBusy,
    draftNeedsAttention,
    pendingElsewhere,
    openReview,
    closeReview: () => {
      dispatch({ type: "reviewClosed" });
      others.close();
    },
    confirmReview: () => void confirmReview(),
    others: others.state,
    current: {
      dirty,
      picked: currentPicked,
      toggle: () => {
        if (currentPicked) setIncludeCurrent(false);
        else {
          setIncludeCurrent(true);
          others.unselectProject(projectId);
        }
      },
    },
    toggleOther: (draftId: string) => {
      const draft =
        others.state?.status === "ready"
          ? others.state.drafts.find((d) => d.draftId === draftId)
          : undefined;
      if (draft?.projectId === projectId && !picked.includes(draft)) setIncludeCurrent(false);
      others.toggle(draftId);
    },
    saveDraft,
    chooseConflict: (path: string, choice: ConflictChoice) =>
      dispatch({ type: "conflictChosen", path, choice }),
    closeConflicts: () => dispatch({ type: "conflictsClosed" }),
    applyConflicts,
    setErrorOpen: (open: boolean) => dispatch({ type: "errorDialogToggled", open }),
    discardChanges,
  };
}
