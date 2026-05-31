import { Button } from "@/components/ui/button";
import { NewPackDialog } from "@/features/account/NewPackDialog";

export function EmptyState() {
  return (
    <div className="grain relative flex h-screen items-center justify-center bg-[var(--bg)]">
      <div className="card relative z-[1] flex max-w-sm flex-col gap-5 p-7 text-center">
        <div className="mx-auto pixel-mark">
          <i /><i /><i /><i /><i /><i /><i /><i /><i />
        </div>
        <h1
          className="display text-[24px] tracking-tight text-[var(--ink)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Bienvenue sur Artisan
        </h1>
        <p className="text-[13.5px] leading-relaxed text-[var(--ink-mut)]">
          Aucun pack encore. Crée ton premier pack pour démarrer — tu pourras y empiler menus,
          commandes et templates depuis le canvas.
        </p>
        <NewPackDialog trigger={<Button variant="primary">Crée ton premier pack</Button>} />
      </div>
    </div>
  );
}
