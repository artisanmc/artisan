/**
 * The state machine of `useProjectLoader`, pure: one reducer instead of nine
 * `useState` reset by hand. Every transition the loader makes is a named event.
 *
 * The parts stay orthogonal where the loader really combines them: a retry
 * keeps the open Project (and its draft) while it reports the server's
 * failure, and the copy's date survives a restart of the read until the
 * server answers.
 */
import type { Project } from "@/domain/types";
import type { FailedDocument } from "@/lib/api/projectFiles";

export interface ProjectLoadState {
  project: Project | null;
  /** The public folder/module ID, for the scope it was resolved in. */
  resolvedUrl: { scope: string; id: string } | null;
  error: string | null;
  offline: boolean;
  failed: FailedDocument[];
  fromDraft: boolean;
  /** The display is the last known version, not what the server holds now. */
  stale: boolean;
  offlineSince: string | null;
  unpublished: boolean;
}

export type ProjectLoadEvent =
  /** A read starts (open, navigation, Refresh). `keepProject`: same scope, already shown. */
  | { type: "started"; keepProject: boolean }
  | { type: "unauthenticated" }
  /** The hub resolved the identity: the canonical folder ID is known. */
  | { type: "located"; scope: string; id: string }
  /** The server is unreachable while this scope is open: the open copy stays, dated. */
  | { type: "connectionLost" }
  /** The server's read failed; the Project is not shown. */
  | { type: "readFailed"; error: string; offline: boolean }
  /** A failure outside the disk read (transport, parse). `retrying`: the server is unreachable. */
  | { type: "loadFailed"; error: string; retrying: boolean }
  /** Documents the server holds but did not load (editable, not running). */
  | { type: "documentsFailed"; failed: FailedDocument[] }
  | { type: "opened"; project: Project; fromDraft: boolean; failed?: FailedDocument[] }
  /**
   * The last known version is on screen, before any round trip: dated (`stale`) until
   * the server's answer settles it.
   */
  | { type: "shownKnown"; project: Project; fromDraft: boolean; failed: FailedDocument[] }
  /**
   * After an open: `since` = the server is off and the copy comes from the hub
   * (dated, rechecked); otherwise the display is the server's state.
   */
  | { type: "settled"; since: string | undefined; unpublished: boolean }
  /** The server answered: no failure left to show. */
  | { type: "validated" };

export const initialProjectLoadState: ProjectLoadState = {
  project: null,
  resolvedUrl: null,
  error: null,
  offline: false,
  failed: [],
  fromDraft: false,
  stale: false,
  offlineSince: null,
  unpublished: false,
};

export function projectLoadReducer(
  state: ProjectLoadState,
  event: ProjectLoadEvent,
): ProjectLoadState {
  switch (event.type) {
    case "started":
      return {
        ...state,
        project: event.keepProject ? state.project : null,
        error: null,
        offline: false,
        failed: [],
        fromDraft: false,
        stale: false,
      };
    case "unauthenticated":
      return { ...state, error: "Not authenticated" };
    case "located":
      return { ...state, resolvedUrl: { scope: event.scope, id: event.id } };
    case "connectionLost":
      return { ...state, offline: true, stale: true };
    case "readFailed":
      return { ...state, project: null, offline: event.offline, error: event.error };
    case "loadFailed":
      return event.retrying
        ? { ...state, offline: true, stale: false, error: event.error }
        : { ...state, error: event.error };
    case "documentsFailed":
      return { ...state, failed: event.failed };
    case "opened":
      return {
        ...state,
        project: event.project,
        fromDraft: event.fromDraft,
        failed: event.failed ?? state.failed,
      };
    case "shownKnown":
      return {
        ...state,
        project: event.project,
        fromDraft: event.fromDraft,
        failed: event.failed,
        stale: true,
      };
    case "settled":
      return event.since
        ? {
            ...state,
            unpublished: event.unpublished,
            offline: true,
            stale: true,
            offlineSince: event.since,
          }
        : { ...state, unpublished: event.unpublished, offlineSince: null, stale: false };
    case "validated":
      return { ...state, offline: false, error: null };
  }
}

/** What the workspace shows for a load. */
export type ProjectLoadStatus = "loading" | "ready" | "error";

/**
 * A failure blocks the workspace only without a draft to keep editing: with
 * one, the server's state is dated and announced, not required.
 */
export function projectLoadStatus(load: {
  project: Project | null;
  error: string | null;
  fromDraft: boolean;
}): ProjectLoadStatus {
  if (load.error && !load.fromDraft) return "error";
  return load.project ? "ready" : "loading";
}
