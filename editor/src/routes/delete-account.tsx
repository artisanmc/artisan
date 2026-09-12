import { DeleteAccountConfirmation } from "@/features/auth/DeleteAccount";
import { accountDeletionToken } from "@/lib/accountDeletionToken";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/delete-account")({ component: DeleteAccountPage });

function DeleteAccountPage() {
  return (
    <div className="flex min-h-full items-center justify-center overflow-auto bg-[var(--surface)] p-8">
      <DeleteAccountConfirmation
        apiUrl={import.meta.env.VITE_API_URL ?? "http://localhost:3001"}
        token={accountDeletionToken}
      />
    </div>
  );
}
