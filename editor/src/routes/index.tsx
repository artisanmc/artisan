import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuthStore } from "@/state/authStore";

export const Route = createFileRoute("/")({
  component: HomeRoute,
});

export function HomeRoute() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const isAuthLoading = useAuthStore((s) => s.isLoading);
  const navigate = useNavigate();

  useEffect(() => {
    if (isAuthLoading) return;
    navigate({
      to: currentUser ? "/networks" : "/login",
    });
  }, [currentUser, isAuthLoading, navigate]);

  return null;
}
