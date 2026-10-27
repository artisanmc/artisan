import "@/i18n";
import { Stage } from "@/features/canvas/Stage";
import { mockAccount } from "@/mock/fixtures";
import { useAccountStore } from "@/state/accountStore";
import { AbsoluteFill } from "remotion";

const account = mockAccount();
useAccountStore.setState({ account });

export function Spike() {
  return (
    <AbsoluteFill style={{ background: "var(--surface)" }}>
      <Stage projectId={account.projects[0].id} />
    </AbsoluteFill>
  );
}
