import { createFileRoute, redirect } from "@tanstack/react-router";
import { useAuthStore } from "@/state/authStore";
import { SetupWizard } from "@/features/setup/SetupWizard";

export const Route = createFileRoute("/setup")({
  beforeLoad() {
    const user = useAuthStore.getState().currentUser;
    if (!user) {
      throw redirect({ to: "/login" });
    }
  },
  component: SetupPage,
});

function SetupPage() {
  return <SetupWizard />;
}
