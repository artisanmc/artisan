# Références de Document qualifiées par project — `project:id`

**Status:** accepted (2026-10-02)

## Contexte

Le plugin rangeait menus et dialogs dans une table unique indexée par id nu, sans
notion de project : deux projects définissant `main`, le dernier chargé gagnait en
silence, et un `open_menu main` ouvrait l'un ou l'autre selon l'ordre de
chargement. L'éditeur, lui, refusait de deviner (lien « ambigu » non dessiné sur la
planche générale). Les deux côtés ne voyaient donc pas le même graphe, et rien ne
permettait de viser explicitement le menu d'un autre project.

L'éditeur reste organisé **par project** (brouillon, conflits, publication) ; il lit
désormais tous les projects du serveur (index serveur). Un project garde un sens
propre — namespace, langue par défaut, traductions — : ce n'est pas qu'un dossier.

## Décision

1. **Le namespace d'un project est son dossier sur le disque du serveur.** Une
   référence qualifiée s'écrit `<dossier>:<id>` (`boutique:main`). `:` ne peut
   apparaître ni dans un nom de dossier de project (refusé par le plugin) ni dans
   un nom de fichier sous Windows.
2. **Résolution lexicale d'un id nu** : d'abord dans le project du Document qui
   référence (menu cliqué, commande, dialog), puis sur le serveur s'il n'y est
   défini qu'une fois. Aucun fichier existant ne change : tous les liens d'avant
   sont locaux ou uniques.
3. **Ambiguïté** (id nu absent du project, défini par plusieurs autres) : le
   plugin ouvre **le dernier chargé**, exactement comme avant, et le dit une fois
   dans le log ; l'éditeur ne dessine pas le lien et la revue de déploiement
   avertit. Aucun menu qui s'ouvrait ne cesse de s'ouvrir.
4. **Le project voyage avec l'exécution** : `ExecutionContext.projectId`, posé par
   la commande (`PackCommand`), par l'ouverture d'un menu ou d'un dialog (les
   clics s'y résolvent dans *son* project) et par les actions de module.
   L'historique de navigation rouvre `projectId:id`, jamais un homonyme.
5. **Un seul algorithme, deux implémentations** : `resolveDocRef`
   (`editor/src/domain/docRef.ts`) et `DocumentTable` (plugin), verrouillés par
   `testdata/doc-ref-conformance.json`.

## Hors périmètre

- **Noms de commandes** : enregistrés par Bukkit à l'échelle du serveur, ils ne
  sont pas des références de Document. Deux projects qui revendiquent `/craft`
  restent en conflit ; la revue de déploiement l'affiche.
- **DSL texte** (`action-dsl`) : sa grammaire n'accepte pas `:` dans un
  identifiant et n'est pas étendue. L'éditeur écrit le format structuré
  (`structured-action-wire`), où `open_menu: boutique:main` est une simple chaîne.
## Éditeur

- Les sélecteurs de cible d'`open_menu` / `open_dialog` listent, sous le nom de
  chaque autre project du serveur (index serveur, état publié), ses menus et
  dialogs ; les choisir écrit la forme qualifiée. Une cible qualifiée s'affiche
  avec son titre et propose les entrées de contexte du menu distant.
- Suivre une référence qualifiée (pastille de lien en vue focus) ouvre le project
  qu'elle nomme (`documentDestination`).

## Conséquences

- Les doublons d'id entre projects ne changent plus ce qui s'ouvre depuis le
  project qui définit l'id ; ils restent signalés, car un appel *sans* project
  (`/artisan menu main`, API) reste ambigu.
- `/artisan menu boutique:main` et `MenuProvider.findMenu(ref, fromProject)`
  acceptent la forme qualifiée.
