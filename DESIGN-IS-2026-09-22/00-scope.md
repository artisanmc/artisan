# Audit UI — bibliothèque et composition des menus

Date : 22 septembre 2026.

Statut : audit initial conservé comme historique. Après validation et implémentation,
le classement final retient « Images de boutons » et « Images du menu » ; fonds et
décorations sont réunis dans ce dernier usage, avec une seule action « Ajouter une
image ». Les guides de `docs-site/src/content/docs/editor/` décrivent le résultat livré.

Périmètre : navigation de l’éditeur, bibliothèque, items du jeu, items capturés, images, ressources graphiques, import et insertion dans les menus, composition du fond/titre et propriétés des éléments.

Utilisateur principal : administrateur de serveur Minecraft construisant un menu. Tâche principale : trouver le bon contenu et comprendre comment l’ajouter, le configurer et le réutiliser.

Question de départ : remplacer « Items » par « Boutons », distinguer Items du jeu / Items capturés / Images et séparer les images de fond des images de boutons.

Contraintes : audit et propositions uniquement ; aucune modification fonctionnelle. Préserver le design system existant et distinguer fichiers sources, usages et éléments de menu. Aucune référence concurrente demandée.

Méthode : inspection des composants, textes et flux de données ; inspection visuelle si une instance accessible existe. Les mesures non disponibles restent explicitement non mesurées.
