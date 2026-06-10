import { describe, expect, it } from "bun:test";
import { ConversationStore } from "./conversations";

const menu = { schema: "menu/v1", id: "shop", title: [], size: 27, layers: [] };

describe("ConversationStore", () => {
	it("creates a conversation seeded with a system message + working-copy", () => {
		const s = new ConversationStore();
		const id = s.create({
			menus: [menu],
			attachments: {},
			ownerKey: "sk:srv_1",
		});
		const conv = s.get(id)!;
		expect(conv.ownerKey).toBe("sk:srv_1");
		expect(conv.messages[0].role).toBe("system");
		expect(conv.messages[0].content.length).toBeGreaterThan(100);
		expect(conv.wc.get("shop")).toBeTruthy();
	});
	it("returns undefined for unknown id", () => {
		expect(new ConversationStore().get("nope")).toBeUndefined();
	});
	it("reseed replaces the working-copy", () => {
		const s = new ConversationStore();
		const id = s.create({ menus: [], attachments: {}, ownerKey: "sk:srv_1" });
		s.reseed(s.get(id)!, [menu], {});
		expect(s.get(id)!.wc.get("shop")).toBeTruthy();
	});
});
