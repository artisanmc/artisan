import { Link, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: AccountHomePage,
});

function AccountHomePage() {
  return (
    <div className="p-8">
      <h1 className="mb-4 font-semibold text-2xl">Account home (placeholder)</h1>
      <Link to="/pack/$packId" params={{ packId: "p_personal" }} className="underline">
        Go to Personal
      </Link>
    </div>
  );
}
