# Projets serveur et hébergés : une seule source de vérité par projet

**Statut :** accepté le 2026-09-12. Phases 1 à 7 vérifiées et déployées localement,
dont la conservation de la démo dans le navigateur et la chaîne protocole
Minecraft. Smoke final validé et fixtures d'acceptation nettoyées. Le
[plan d'exécution](../superpowers/plans/2026-09-12-project-storage-modes.md)
porte les migrations, tests et critères de livraison.

Le stockage hébergé utilise désormais un volume durable, avec un répertoire de
projet lisible dans chaque révision immuable et une activation par pointeur atomique.
La même révision porte fichiers publiés, binaires, historique et enveloppes privées :
publier un brouillon et le marquer publié n'a qu'un seul point d'activation. Un verrou
consultatif PostgreSQL par racine sérialise les workers. L'index vérifie les octets
sur disque ; une modification manuelle incohérente provoque une erreur explicite.
Le renommage déplace le dossier dans une révision puis réconcilie le journal SQL
commun, en conservant l'ancre interne. Les projets hébergés gardent leur version
Minecraft sélectionnée dans les métadonnées d'environnement SQL, hors manifeste.
La [procédure de sauvegarde/restauration](../operations/hosted-storage-backup.md)
décrit les verrous, le snapshot SQL exporté et les règles de rétention.

## Contexte

**Révision 2026-09-27** : l'hébergé est retiré pour les comptes, la démo devient
jetable (export seulement) — voir [server-only-projects](server-only-projects.md).

**Révision 2026-09-26** : les brouillons des projets serveur reviennent côté
backend, avec un miroir d'instantané et des Versions — voir
[snapshot-mirror-and-backend-history](snapshot-mirror-and-backend-history.md).
Direction décidée : le mode hébergé sera remplacé par des Servers non reliés.

Le disque Minecraft convient aux projets liés à un serveur, mais imposer un
serveur connecté empêche de découvrir immédiatement Artisan ou de préparer un
projet avant installation. Deux emplacements de stockage doivent partager le
même éditeur et les mêmes règles métier.

Cette décision révise la restriction de
[server-disk-only-storage](server-disk-only-storage.md) aux seuls projets serveur.
Elle prévoit aussi une exception invitée confinée à la démo par rapport à
[accounts-only-editing](accounts-only-editing.md). Ces changements restent soumis
aux migrations et protections du plan ; les anciens parcours restent valides
tant que leur remplacement n'est pas vérifié.

## Décisions

### Autorité et format

Chaque Project possède un seul stockage actif pour ses fichiers, assets,
historique et brouillons : disque Minecraft ou volume durable du backend.
Le format fichier est commun. Les métadonnées SQL servent à l'identité, aux
autorisations et aux index ; elles ne constituent pas une seconde représentation
éditable du contenu. Les binaires restent des fichiers.

Les brouillons serveur sont destinés à `.artisan/drafts/`, exclus des lectures
ordinaires et du contenu publié. Leur migration conserve propriétaires,
révisions et contenu avant tout retrait de la copie backend. Le secours local
du navigateur protège la saisie et ne devient pas un troisième stockage actif.

La transition conserve les résultats historiques des mutations SQL pendant 24 h
après basculement, uniquement pour rejouer un ACK perdu. Ils sont non modifiables
et ne servent jamais de source de contenu ; l'expiration les remplace par un
marqueur `operation_expired`, sans rejouer la mutation sur le serveur.
Les reçus et blobs privés du plugin restent conservés avec son journal ; aucune
rétention automatique n'est encore garantie. Sauvegardes et futurs quotas doivent
compter `.artisan/`, y compris brouillons, blobs, reçus et marqueurs de révocation.

### Interfaces et capacités

Une interface `ProjectStorage` définit les opérations communes. Les adaptateurs
`ServerProjectStorage` et `HostedProjectStorage` sont composés avec les services
métier. Un resolver central choisit le stockage depuis la localisation autorisée
du projet ; le navigateur ne peut pas imposer ce choix.

L'éditeur reçoit un contexte et un client communs. Les différences fonctionnelles
passent par des capacités explicites, comme les données live ou la capture en jeu.
Les composants, l'autosave et les règles métier ne multiplient pas les branches
sur le type de stockage. Des tests de contrat communs vérifient les adaptateurs.

### Identité et add-ons

Pour un projet classique, le nom du dossier détermine l'ID côté fichiers ;
`projects.id` reste une ancre backend immuable. Le manifeste ne fait plus autorité
via `project_id`. Le renommage par l'éditeur conserve les liens ; un renommage
manuel est découvert comme une nouvelle identité.

Un add-on conserve durablement son ID explicite via l'API stable
`register(projectId, dir)`, indépendamment du dossier. Le resolver transmet cette
identité au reste du système ; ces projets ne sont pas renommables dans l'éditeur.
L'ID cible du projet Boutique est `boutique_addon`. Sa migration depuis
`boutique_shop` doit préserver l'identité interne, les liens et les brouillons,
sans renommer le module, ses namespaces ou son dossier par convention.

### Accès, hébergement et copie

L'interface générale reste accessible sans Minecraft. Ouvrir un projet serveur
requiert un serveur connecté ; une coupure préserve la saisie et suspend les
enregistrements jusqu'à une reprise avec contrôle des conflits. Les projets
hébergés authentifiés appartiennent à un Network et fonctionnent sans serveur.

« Copier vers un serveur » crée un projet indépendant à partir d'une révision
figée, assets compris. Cette opération ne crée pas de synchronisation permanente
entre les deux projets et ne publie pas de copie partielle en jeu.

### Démo anonyme

Une démo sans compte possède un projet temporaire isolé stocké sur le backend,
avec ses fichiers, assets et brouillons. Un cookie opaque HttpOnly permet de le
retrouver dans le même navigateur. Le navigateur n'est pas le stockage principal.

La démo expire après **24 heures d'inactivité effective**, délai configurable.
Les mutations effectives renouvellent ce délai ; un polling ou heartbeat ne le
prolonge pas. Le backend fournit `expiresAt` à l'interface. Effacer le cookie ou
changer de navigateur ne permet pas de retrouver la même démo.

L'inscription ou la connexion permet de réclamer la démo dans un Network
autorisé, en préservant contenu et brouillon et en retirant l'expiration de démo.
La réclamation et la purge doivent être coordonnées et idempotentes. Les invités
n'ont aucun accès aux serveurs ni à l'IA facturée. Les quotas par défaut sont
un projet par session, 20 MiB et 1 000 fichiers physiques, staging, historique
et brouillons compris.

## Conséquences et livraison

Le stockage hébergé exige sauvegarde et restauration conjointes du volume et des
métadonnées, contrôle des quotas et purge des sessions expirées. Les deux modes
nécessitent les mêmes garanties d'isolation, CAS, atomicité et reprise.

La livraison est progressive : contrats et identité, brouillons serveur,
hébergement authentifié, copie vers Minecraft, puis démo. Chaque basculement
doit vérifier les données avant de supprimer une ancienne copie. Un rollback
conserve les données et ne réactive pas une source de vérité obsolète.
