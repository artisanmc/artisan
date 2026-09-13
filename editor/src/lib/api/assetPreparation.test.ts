import * as persisted from "@/features/project/persistedDrafts";
import { useAuthStore } from "@/state/authStore";
import { useDemoStore } from "@/state/demoStore";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { uploadAsset, uploadFontAsset } from "./userAssets";
vi.mock("@/state/accountStore", () => ({
  useAccountStore: { getState: () => ({ setAccount: vi.fn() }) },
}));
let readers: Array<{ result: string; onload?: () => void }>;
beforeEach(() => {
  readers = [];
  useAuthStore.setState({ currentUser: null });
  useDemoStore.getState().setSession({
    principal: { kind: "guest", id: "guest" },
    projectId: "demo",
    csrfToken: "csrf",
    expiresAt: "2099-01-01",
  });
  vi.stubGlobal(
    "FileReader",
    class {
      result = "data:image/png;base64,AQ==";
      onload?: () => void;
      readAsDataURL() {
        readers.push(this);
      }
    },
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useDemoStore.getState().setSession(null);
});
test.each(["png", "font"])(
  "claim write barrier waits for deferred %s serialization and its upload ACK",
  async (type) => {
    let acknowledge!: (value: never) => void;
    const mutation = vi.spyOn(persisted, "mutateDraftAssets").mockImplementation(
      () =>
        new Promise((resolve) => {
          acknowledge = resolve;
        }),
    );
    const file = new File(["x"], type === "png" ? "image.png" : "font.ttf");
    const uploading =
      type === "png"
        ? uploadAsset("demo", { file, type: "glyph", name: "image" })
        : uploadFontAsset("demo", { file, name: "font" });
    let confirmed = false;
    const barrier = persisted.waitForDraftWrites("demo").then(() => {
      confirmed = true;
    });
    await vi.waitFor(() => expect(readers).toHaveLength(1));
    expect(confirmed).toBe(false);
    expect(mutation).not.toHaveBeenCalled();
    readers[0]!.onload!();
    await vi.waitFor(() => expect(mutation).toHaveBeenCalledOnce());
    expect(confirmed).toBe(false);
    acknowledge({ asset: { id: "asset" }, draft: {} } as never);
    await uploading;
    await barrier;
    expect(confirmed).toBe(true);
  },
);
test("a changed principal during file preparation cannot upload to the next identity", async () => {
  const mutation = vi.spyOn(persisted, "mutateDraftAssets");
  const uploading = uploadAsset("demo", {
    file: new File(["x"], "image.png"),
    type: "glyph",
    name: "image",
  });
  const rejection = expect(uploading).rejects.toThrow("session_changed");
  await vi.waitFor(() => expect(readers).toHaveLength(1));
  useDemoStore.getState().setSession(null);
  readers[0]!.onload!();
  await rejection;
  expect(mutation).not.toHaveBeenCalled();
});
