/**
 * Éditeur servi par le plugin (build `VITE_SELF_HOSTED=1`, `VITE_API_URL=""`) : même
 * origine que l'API, connexion par le lien de `/artisan editor`, un seul serveur.
 */
export const SELF_HOSTED = import.meta.env.VITE_SELF_HOSTED === "1";

/** Identifiant du réseau et du serveur uniques que sert le plugin. */
export const LOCAL_ID = "local";
