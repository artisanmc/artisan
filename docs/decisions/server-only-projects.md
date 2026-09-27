# Projets serveur uniquement — l'hébergé est retiré, la démo est jetable

**Status :** accepted (2026-09-27) — rien n'est implémenté. Révise
[project-storage-modes](project-storage-modes.md) (projets hébergés, réclamation de
la démo, « Copier vers Minecraft », import ZIP hébergé) et remplit la direction
laissée par [snapshot-mirror-and-backend-history](snapshot-mirror-and-backend-history.md).

## Contexte

Le mode hébergé répondait à « préparer un Project sans serveur » et à « garder la
démo après inscription ». Depuis que brouillons, Versions et Snapshot vivent dans
le backend, un Server **non relié** peut porter des Projects faits de brouillons :
le second stockage n'apporte plus rien. Personne ne l'a utilisé en prod.

## Décisions

1. **Tout Project de compte appartient à un Server**, relié ou non. Plus de
   projets hébergés, plus de « Copier vers un serveur ». Aucune migration : aucun
   projet hébergé réel en prod.
2. **Créer un Project sur un Server non relié (ou hors ligne) est permis** : il
   naît avec un brouillon vide. Sa première publication, une fois le serveur relié,
   crée le dossier sur le disque ; un dossier déjà présent est un conflit normal
   (modale existante). Le rattachement ne publie jamais rien.
3. **La démo est jetable** : pas de réclamation dans un compte (états
   `claiming`/`claimed`, dialogue de choix du Network, reprise idempotente —
   supprimés). Elle expire après 24 h d'inactivité ; on la garde en l'**exportant**
   en ZIP.
4. **L'import ZIP est retiré** avec l'hébergé, dont il était la seule cible. Il
   reviendra plus tard, vers un Server, sous forme d'un nouveau Project en brouillon.

*Rejeté :* rattacher la démo à un serveur au moment de déployer (machinerie pour
des démos simples, qu'un export couvre) ; publier directement à l'import (écriture
non relue sur un serveur en marche) ; garder l'import sur l'hébergé (maintient le
second stockage pour une seule porte d'entrée).

## Livraison

1. Retirer l'hébergé côté comptes : section, création, copie vers Minecraft,
   import ZIP, réclamation de la démo ; permettre la création sur Server non relié.
   La démo reste provisoirement sur le stockage hébergé.
2. Basculer la démo en base : un Project démo n'a qu'un brouillon (`project_drafts`,
   `project_draft_blobs`), publication désactivée, export depuis le brouillon,
   expiration en cascade. Puis supprimer `HostedProjectStorage`, le volume, sa
   maintenance et sa procédure de sauvegarde.
