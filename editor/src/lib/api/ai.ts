import { apiFetch } from "./client";

/** The editor's assistant on the hub (ADR `editor-assistant`): is it there, may this player use it. */
export interface AiStatus {
  enabled: boolean;
  model: string | null;
  canUse: boolean;
}

export interface AiConversationSummary {
  id: string;
  project: string | null;
  title: string | null;
  running: boolean;
  createdAt: string;
  lastActive: string;
  inputTokens: number;
  outputTokens: number;
}

/** A draft the assistant made or wrote into: the panel offers to open it. */
export interface AiDraftRef {
  project: string;
  id: string;
  name?: string;
}

/** One line of the conversation, in order (`seq` from 0). */
export type AiEvent =
  | { seq: number; type: "user"; text: string }
  | { seq: number; type: "text"; text: string }
  | {
      seq: number;
      type: "tool";
      name: string;
      project?: string;
      path?: string;
      ok: boolean;
      error?: string;
      problems?: number;
      draft?: AiDraftRef;
    }
  | { seq: number; type: "notice"; code: string; steps?: number }
  | { seq: number; type: "error"; code: string }
  | { seq: number; type: "done"; inputTokens: number; outputTokens: number };

export interface AiConversation extends AiConversationSummary {
  events: AiEvent[];
}

const STATUS = "/api/v1/ai";
const CONVERSATIONS = "/api/v1/ai/conversations";

export function getAiStatus(): Promise<AiStatus> {
  return apiFetch(STATUS);
}

export function createAiConversation(project: string | null): Promise<AiConversationSummary> {
  return apiFetch(CONVERSATIONS, { method: "POST", json: { project } });
}

/** The events after the `after` first ones: a poll only carries what is new. */
export function readAiConversation(id: string, after = 0): Promise<AiConversation> {
  return apiFetch(`${CONVERSATIONS}/${encodeURIComponent(id)}?after=${after}`);
}

/** Rejects with `ai_busy` while the assistant still answers the previous message. */
export async function sendAiMessage(id: string, text: string): Promise<void> {
  await apiFetch(`${CONVERSATIONS}/${encodeURIComponent(id)}/messages`, {
    method: "POST",
    json: { text },
  });
}

/**
 * The assistant's settings as the hub shows them to `artisan.editor.config` (ADR
 * `editor-assistant`): the key never comes back, only its last characters.
 */
export interface AiSettings {
  /** `file`: environment.yml sets them, read-only here. `database`: saved from the editor. */
  source: "file" | "database" | "none";
  editable: boolean;
  enabled: boolean;
  provider: string | null;
  model: string;
  effort: string;
  maxSteps: number;
  baseUrl: string;
  keyHint: string | null;
  providers: string[];
  efforts: string[];
  defaultModel: string;
}

export interface AiSettingsInput {
  provider: string;
  model: string;
  effort: string;
  maxSteps: number;
  baseUrl: string;
  /** Left out: the saved key stays, unless the provider or the address changes. */
  apiKey?: string;
}

const CONFIG = "/api/v1/ai/config";

export function getAiSettings(): Promise<AiSettings> {
  return apiFetch(CONFIG);
}

/** Applied at once: the hub's assistant restarts on them. */
export function saveAiSettings(input: AiSettingsInput): Promise<AiSettings> {
  return apiFetch(CONFIG, { method: "PUT", json: input });
}

/** Turns the assistant off and forgets the key. */
export function deleteAiSettings(): Promise<AiSettings> {
  return apiFetch(CONFIG, { method: "DELETE" });
}
