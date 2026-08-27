import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "react-i18next";

/**
 * L'attente d'un Project, à la forme de ce qui va s'afficher.
 *
 * Le contenu se lit sur le disque de SON serveur : il y a forcément un délai,
 * et le nier avec une page blanche le fait passer pour une panne. Un squelette
 * qui reprend la disposition réelle — barre du haut, arbre à gauche, canvas —
 * tient la mise en page pendant ce délai, de sorte que l'arrivée des données ne
 * fasse pas sauter l'écran.
 *
 * Le libellé reste : un squelette dit « bientôt », il ne dit pas QUOI on
 * attend ni d'où ça vient.
 */
export function ProjectLoadingSkeleton() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="project-skeleton">
      {/* Barre du haut : marque, nav de vues, actions à droite. */}
      <div className="flex items-center gap-3 border-b border-[var(--border-soft)] px-4 py-2.5">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-6 w-56" />
        <div className="flex-1" />
        <Skeleton className="h-6 w-20" />
        <Skeleton className="h-6 w-6 rounded-full" />
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Arbre des Documents. */}
        <div className="hidden w-[240px] shrink-0 flex-col gap-2 border-r border-[var(--border-soft)] p-3 lg:flex">
          <Skeleton className="h-4 w-24" />
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-8 w-full" style={{ opacity: 1 - i * 0.15 }} />
          ))}
        </div>

        {/* Canvas. */}
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-6">
          <Skeleton className="h-[280px] w-full max-w-[520px]" />
          <p className="text-[13px] text-[var(--text-mut)]">{t("project.loading")}</p>
        </div>
      </div>
    </div>
  );
}
