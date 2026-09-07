import { projectId } from "@/domain/ids";
import { openConversation } from "@/lib/api/assistant";
import { useAccountStore } from "@/state/accountStore";
import { useAuthStore } from "@/state/authStore";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AssistantChat } from "./AssistantChat";
vi.mock("./MigrationPanel", () => ({
	MigrationPanel: ({
		ensureConversation,
	}: { ensureConversation(): Promise<string> }) => (
		<button type="button" onClick={() => void ensureConversation()}>
			Open migration
		</button>
	),
}));
vi.mock("@/lib/api/assistant", () => ({
	openConversation: vi.fn(),
	getConversation: vi.fn(),
	AssistantRequestError: class extends Error {},
	streamAssistant: vi.fn(async function* () {
		yield { type: "done" };
	}),
}));
it("shares one conversation creation between migration and chat while the server is slow", async () => {
	const pending = Promise.withResolvers<string>();
	vi.mocked(openConversation).mockReturnValue(pending.promise);
	useAuthStore.setState({ currentUser: { id: "u1", email: "a@b.c" } } as never);
	useAccountStore
		.getState()
		.setAccount({ id: "a", projects: [], projectOrder: [] } as never);
	useAccountStore.getState().createProject({ id: "p" });
	render(<AssistantChat projectId={projectId("p")} />);
	fireEvent.click(screen.getByText("Open migration"));
	fireEvent.change(screen.getByRole("textbox"), { target: { value: "Hello" } });
	fireEvent.click(screen.getByRole("button", { name: /^(send|envoyer)$/i }));
	expect(openConversation).toHaveBeenCalledTimes(1);
	await act(async () => pending.resolve("shared"));
	await waitFor(() => expect(screen.getByRole("textbox")).not.toBeDisabled());
	expect(openConversation).toHaveBeenCalledTimes(1);
});
