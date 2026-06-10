import { buildSystemPrompt } from "./grounding";
import type { LlmMessage } from "./provider/types";
import { type MenuV1, WorkingCopy } from "./workingCopy";

export interface Conversation {
	id: string;
	/**
	 * Owner of the conversation, for cross-tenant isolation. Format:
	 * `sk:<serverKeyId>` (plugin editor-session) or `user:<userId>` (web login).
	 * Mixed so the assistant works in both auth modes (see routes.ts middleware).
	 */
	ownerKey: string;
	messages: LlmMessage[];
	wc: WorkingCopy;
}

export class ConversationStore {
	private map = new Map<string, Conversation>();

	create(opts: {
		menus: MenuV1[];
		attachments: Record<string, string>;
		ownerKey: string;
	}): string {
		const id = crypto.randomUUID();
		this.map.set(id, {
			id,
			ownerKey: opts.ownerKey,
			messages: [{ role: "system", content: buildSystemPrompt() }],
			wc: new WorkingCopy(opts.menus, opts.attachments),
		});
		return id;
	}
	get(id: string): Conversation | undefined {
		return this.map.get(id);
	}
	reseed(
		conv: Conversation,
		menus: MenuV1[],
		attachments: Record<string, string>,
	): void {
		conv.wc = new WorkingCopy(menus, attachments);
	}
}
