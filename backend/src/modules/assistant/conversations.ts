import { WorkingCopy, type MenuV1 } from "./workingCopy";
import type { LlmMessage } from "./provider/types";
import { buildSystemPrompt } from "./grounding";

export interface Conversation {
  id: string;
  serverKeyId: string;
  messages: LlmMessage[];
  wc: WorkingCopy;
}

export class ConversationStore {
  private map = new Map<string, Conversation>();

  create(opts: { menus: MenuV1[]; attachments: Record<string, string>; serverKeyId: string }): string {
    const id = crypto.randomUUID();
    this.map.set(id, {
      id,
      serverKeyId: opts.serverKeyId,
      messages: [{ role: "system", content: buildSystemPrompt() }],
      wc: new WorkingCopy(opts.menus, opts.attachments),
    });
    return id;
  }
  get(id: string): Conversation | undefined { return this.map.get(id); }
  reseed(conv: Conversation, menus: MenuV1[], attachments: Record<string, string>): void {
    conv.wc = new WorkingCopy(menus, attachments);
  }
}
