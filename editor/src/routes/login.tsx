import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LoginForm } from "@/features/auth/LoginForm";

export const Route = createFileRoute("/login")({ component: LoginPage });

function LoginPage() {
  const navigate = useNavigate();
  const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <LoginForm apiUrl={apiUrl} onSuccess={() => navigate({ to: "/account" })} />
    </div>
  );
}
