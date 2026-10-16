import type { EditorTourProgress } from "@/lib/api/auth";

export const EDITOR_TOUR_GUEST_KEY = "artisan:editor-tour:guest";
export const EDITOR_TOUR_TRANSFER_KEY = "artisan:editor-tour:transfer";
type TourStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
interface TransferIntent {
  playerId: string | null;
  progress: EditorTourProgress;
  returnTo: string;
}

function validProgress(value: unknown): value is EditorTourProgress {
  if (!value || typeof value !== "object") return false;
  const progress = value as EditorTourProgress;
  return (
    Number.isInteger(progress.step) &&
    progress.step >= 0 &&
    progress.step <= 6 &&
    typeof progress.completed === "boolean"
  );
}

function parseStored(value: string | null): unknown {
  try {
    return value === null ? null : JSON.parse(value);
  } catch {
    return null;
  }
}

export function createEditorTourStorage(local: () => TourStorage, session: () => TourStorage) {
  let guestMemory: EditorTourProgress | null = null;
  let guestMemoryOnly = false;
  let transferMemory: TransferIntent | null = null;
  let transferMemoryOnly = false;
  const readIntent = (): TransferIntent | null => {
    if (transferMemoryOnly) return transferMemory;
    try {
      const value = session().getItem(EDITOR_TOUR_TRANSFER_KEY);
      const intent = parseStored(value) as TransferIntent | null;
      transferMemory =
        intent &&
        (intent.playerId === null || typeof intent.playerId === "string") &&
        validProgress(intent.progress) &&
        typeof intent.returnTo === "string"
          ? intent
          : null;
    } catch {
      transferMemoryOnly = true;
    }
    return transferMemory;
  };
  const writeIntent = (intent: TransferIntent | null) => {
    transferMemory = intent;
    try {
      if (intent) session().setItem(EDITOR_TOUR_TRANSFER_KEY, JSON.stringify(intent));
      else session().removeItem(EDITOR_TOUR_TRANSFER_KEY);
      transferMemoryOnly = false;
    } catch {
      transferMemoryOnly = true;
    }
  };
  const storage = {
    readGuest(): EditorTourProgress | null {
      if (guestMemoryOnly) return guestMemory;
      try {
        const value = local().getItem(EDITOR_TOUR_GUEST_KEY);
        const progress = parseStored(value);
        guestMemory =
          value === null
            ? null
            : validProgress(progress)
              ? progress
              : (guestMemory ?? { step: 0, completed: false });
      } catch {
        guestMemoryOnly = true;
      }
      return guestMemory;
    },
    writeGuest(progress: EditorTourProgress) {
      guestMemory = progress;
      try {
        local().setItem(EDITOR_TOUR_GUEST_KEY, JSON.stringify(progress));
        guestMemoryOnly = false;
      } catch {
        guestMemoryOnly = true;
      }
    },
    prepareTransfer(playerId: string | null, returnTo: string) {
      if (playerId) return;
      const progress = storage.readGuest();
      if (progress) writeIntent({ playerId: null, progress, returnTo });
    },
    bindTransfer(playerId: string, returnTo: string | null) {
      const intent = readIntent();
      if (intent?.playerId === null)
        writeIntent(intent.returnTo === returnTo ? { ...intent, playerId } : null);
    },
    readTransfer(playerId: string): EditorTourProgress | null {
      const intent = readIntent();
      return intent?.playerId === playerId ? intent.progress : null;
    },
    clearTransfer(playerId: string) {
      if (readIntent()?.playerId === playerId) writeIntent(null);
    },
  };
  return storage;
}
