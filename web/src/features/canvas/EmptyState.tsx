import { Button } from "@/components/ui/button";
import { NewPackDialog } from "@/features/account/NewPackDialog";

export function EmptyState() {
  return (
    <div className="flex h-screen items-center justify-center bg-[var(--color-bg)]">
      <div className="flex max-w-sm flex-col gap-4 rounded-md border border-zinc-800 bg-zinc-950 p-6 text-center">
        <h1 className="font-semibold text-xl text-zinc-100">Bienvenue sur Interfaze</h1>
        <p className="text-sm text-zinc-400">
          Aucun pack encore. Crée ton premier pack pour démarrer — tu pourras y empiler menus,
          commandes et templates depuis le canvas.
        </p>
        <NewPackDialog trigger={<Button>Crée ton premier pack</Button>} />
      </div>
    </div>
  );
}
