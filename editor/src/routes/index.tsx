import { Navigate, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: HomeRoute,
});

export function HomeRoute() {
  return <Navigate to="/servers" replace />;
}
