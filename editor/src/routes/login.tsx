import { SelfHostedSignIn } from "@/features/selfHosted/SelfHostedSignIn";
import { safeAuthReturn } from "@/lib/authReturn";
import { useAuthStore } from "@/state/authStore";
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/login")({
  beforeLoad: ({ search }) => {
    // Already-authenticated users have no business on /login. Bounce them to
    // their requested `?next=` target (if safe) or to the editor home.
    const user = useAuthStore.getState().currentUser;
    if (user) {
      const next = (search as { next?: string } | undefined)?.next;
      throw redirect({ to: safeAuthReturn(next) });
    }
  },
  component: LoginPage,
});

function LoginPage() {
  return (
    <div className="grain relative flex min-h-screen items-center justify-center bg-[var(--surface)] p-8">
      <div aria-hidden className="page-glow pointer-events-none absolute inset-0" />
      <SelfHostedSignIn expired={new URLSearchParams(window.location.search).has("expired")} />
    </div>
  );
}
