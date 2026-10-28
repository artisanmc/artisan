import { SelfHostedSignIn } from "@/features/selfHosted/SelfHostedSignIn";
import { safeAuthReturn } from "@/lib/authReturn";
import { useAuthStore } from "@/state/authStore";
import { Navigate, createFileRoute, redirect } from "@tanstack/react-router";

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

export function LoginPage() {
  const user = useAuthStore((s) => s.currentUser);
  const search = new URLSearchParams(window.location.search);
  // A full page load reaches beforeLoad before the session is known: leave once it is.
  if (user) return <Navigate to={safeAuthReturn(search.get("next"))} replace />;
  return (
    <div className="grain relative flex min-h-screen items-center justify-center bg-[var(--surface)] p-8">
      <div aria-hidden className="page-glow pointer-events-none absolute inset-0" />
      <SelfHostedSignIn expired={search.has("expired")} />
    </div>
  );
}
