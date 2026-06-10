import { packId } from "@/domain/ids";
import type { Pack } from "@/domain/types";
import { saveUserPack } from "@/lib/api/userPacks";
import { savePack } from "@/lib/packApi";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { persistPack } from "./persistPack";

vi.mock("@/lib/packApi", () => ({ savePack: vi.fn() }));
vi.mock("@/lib/api/userPacks", () => ({ saveUserPack: vi.fn() }));

function emptyPack(): Pack {
  return {
    id: packId("p"),
    name: "p",
    source: "user_created",
    createdAt: "",
    updatedAt: "",
    menus: [],
    commands: [],
    templates: [],
    assets: [],
    dataSources: [],
    importedConnectors: [],
    i18nKeys: {},
    defaultLang: "en",
    dialogs: [],
    canvasLayout: {},
  } as Pack;
}

beforeEach(() => vi.clearAllMocks());

describe("persistPack", () => {
  it("session mode (token) → savePack", async () => {
    await persistPack(emptyPack(), "tok", false);
    expect(savePack).toHaveBeenCalledTimes(1);
    expect(saveUserPack).not.toHaveBeenCalled();
  });

  it("user-auth mode (no token, logged-in user) → saveUserPack", async () => {
    await persistPack(emptyPack(), null, true);
    expect(saveUserPack).toHaveBeenCalledTimes(1);
    expect(savePack).not.toHaveBeenCalled();
  });

  it("no auth → no-op (neither endpoint called)", async () => {
    await persistPack(emptyPack(), null, false);
    expect(savePack).not.toHaveBeenCalled();
    expect(saveUserPack).not.toHaveBeenCalled();
  });
});
