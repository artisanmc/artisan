# Un Menu paramétré unique plutôt qu'un Menu par catégorie

**Status:** accepted (2026-08-11)

## Context

La reprise d'une boutique legacy (config MenuAPI : 7 catégories, 41 articles, chacun
portant un `page`/`slot` explicite) demandait de rendre une mise en page hand-authored,
donc le **placement** plutôt que la pagination.

Première implémentation : **un Menu par catégorie**, chacun filtrant la source sur son
id et plaçant ses propres articles. Ça rendait la mise en page fidèlement, et le
placement y gardait une sémantique simple — une source, un écran, des slots.

Le coût s'est révélé à l'usage, et il ne porte pas sur la migration mais sur **la vie
d'après**. Ajouter une catégorie demandait cinq gestes : créer la ligne au catalogue,
créer un Menu, ajouter au Menu principal un élément qui pointe dessus, configurer le
filtre du Menu cible, placer les articles. Quatre artefacts corrélés pour un concept
qui devrait en être un seul — et le même problème attend tout module de contenu
(quêtes, kits), pas seulement la boutique.

Le diagnostic initial visait le **catalogue** (« la donnée métier devrait vivre dans le
Menu »). Il était faux : le catalogue n'a jamais été la contrainte, la découpe en
Menus l'était.

## Decision

Un **Menu paramétré unique** est la forme par défaut d'un écran répété : un seul
document, une source filtrée par un input, et les **Placements de tous les contextes**
portés par le même Élément.

Ajouter une catégorie redevient **un geste** : créer la ligne. Le Menu existe déjà, le
filtre est dynamique, le lien depuis le Menu principal l'est aussi
(`open_menu shop_category with category="{cat.id}"`), et le nouveau **Preview context**
apparaît tout seul dans l'éditeur puisqu'il est dérivé des call sites.

Une catégorie qui mérite vraiment un écran à part garde son **Menu dédié** — il suffit
que le Menu principal pointe ailleurs pour celle-là. Le cas général coûte un geste, le
cas particulier reste possible, et personne ne paie pour une souplesse qu'il n'utilise
pas.

## Considered options

**Un Menu par catégorie** — rejeté pour la chorégraphie décrite plus haut. Reste
l'échappatoire pour un écran atypique.

**Un troisième mode de rendu, où la position vient d'un champ de la ligne**
(`position_field`, l'article porte son `slot`). Séduisant : il donnait le Menu unique
*et* les slots, sans rien changer d'autre. Rejeté parce que le mode **placement est le
bon concept** — la difficulté n'était pas le modèle mais l'éditeur, qui ne montrait ni
le contexte regardé ni les lignes restant à placer. Ajouter un mode aurait figé un
défaut d'UX dans le schéma. Et la position serait devenue une propriété de l'article,
donc inexprimable dès qu'un article apparaît sur deux écrans.

**La donnée métier dans le document du Menu** — un module déclare un type d'élément
(prix, description, actions), l'admin le pose dans un slot, la valeur vit dans
`menus/*.yaml`. Rejeté : ça déplaçait l'autorité du prix hors du module, imposait une
API pour que les modules lisent les éléments sans parser `menu/v1`, et créait une
seconde façon de déclarer de la donnée métier à côté des Tables. Le tout pour résoudre
un problème qui n'était pas là. À rouvrir seulement si un besoin réel apparaît, avec le
critère « cette donnée a-t-elle une vie hors du Menu ? » (une quête oui, un article de
boutique non).

## Consequences

**L'éditeur devient responsable de la lisibilité.** Un Menu paramétré porte les
Placements de tous ses contextes : lu sans contexte, c'est un tas d'épingles
contradictoires. Et sans contexte choisi il ne rend **rien** — l'input retombe sur son
`default`, le filtre compare à une valeur vide, aucune ligne ne sort (donner un
`default` à l'input est donc le moyen de fixer un contexte de repli). Trois manques
deviennent bloquants plutôt que cosmétiques :

- le **Preview context** doit être visible et manipulable depuis le board — par
  l'arête (cliquer le lien fixe le contexte de la cible) et par un bandeau permanent
  sur le Menu (« Vu depuis : Boutique › Les Clés ») — et non enfoui dans un panneau de
  propriétés ;
- les lignes **non placées** du contexte courant doivent se voir : un plateau flottant
  ancré au Menu, présent uniquement s'il reste du travail, d'où l'on glisse les tuiles
  (le glisser-déposer, lui, existe déjà) ;
- rien de tout ça pour un Menu paginé, où il n'y a pas de position à décider.

**La migration ne dépend pas de cette UX** : le migrateur génère les Placements depuis
les slots legacy, donc une reprise arrive déjà placée. L'UX sert à la vie d'après.

**Le catalogue reste en Table.** Aucune donnée métier ne migre vers les documents de
Menu.
