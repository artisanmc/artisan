import { Button } from "@/components/ui/button";
import { NewProjectDialog } from "@/features/account/NewProjectDialog";

export function EmptyState() {
  return (
    <div className="grain relative flex h-screen items-center justify-center bg-[var(--surface)]">
      <div className="card relative z-[1] flex max-w-sm flex-col gap-5 p-7 text-center">
        <img
          src="/logo.svg"
          alt=""
          aria-hidden="true"
          width={28}
          height={28}
          className="mx-auto size-7 shrink-0"
        />
        <h1
          className="display text-[24px] tracking-tight text-[var(--text)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Bienvenue sur Artisan
        </h1>
        <p className="text-[13.5px] leading-relaxed text-[var(--text-mut)]">
          Aucun workspace encore. Crée ton premier workspace pour démarrer — tu pourras y empiler
          menus, commandes et templates depuis le canvas.
        </p>
        <NewProjectDialog trigger={<Button variant="primary">Crée ton premier workspace</Button>} />
      </div>
    </div>
  );
}
