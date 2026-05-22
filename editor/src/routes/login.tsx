import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LoginForm } from "@/features/auth/LoginForm";

export const Route = createFileRoute("/login")({ component: LoginPage });

function LoginPage() {
  const navigate = useNavigate();
  const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

  function handleLoginSuccess() {
    const params = new URLSearchParams(window.location.search);
    const next = params.get("next");
    const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/account";
    navigate({ to: safeNext });
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <LoginForm apiUrl={apiUrl} onSuccess={handleLoginSuccess} />
    </div>
  );
}
