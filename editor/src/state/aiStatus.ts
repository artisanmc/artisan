import { type AiStatus, getAiStatus } from "@/lib/api/ai";
import { useEffect, useState } from "react";

let status: Promise<AiStatus> | undefined;

/** Whether the hub has an assistant this player may use; asked once per page. */
export function useAiStatus(): AiStatus | undefined {
  const [value, setValue] = useState<AiStatus>();
  useEffect(() => {
    status ??= getAiStatus().catch(() => ({ enabled: false, model: null, canUse: false }));
    let live = true;
    void status.then((s) => live && setValue(s));
    return () => {
      live = false;
    };
  }, []);
  return value;
}

/** Forgets the cached status (tests, sign-in change, settings saved). */
export function resetAiStatus() {
  status = undefined;
}
