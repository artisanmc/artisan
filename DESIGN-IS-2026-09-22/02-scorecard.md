# Grille Rams — évaluation partielle

Les preuves sont dans 01-evidence.md. Les notes sont des jugements d’audit du code et des parcours, pas des résultats de tests utilisateurs. Le protocole standard demande un total /30 : il n’est pas calculé, car inventer les mesures de poids ou une comparaison concurrentielle serait trompeur.

| Principe, dans l’ordre Rams | Note /3 | Preuve et justification |
|---|---:|---|
| 1. Innovant | Non évalué | E1/E4 : mécanismes utiles de capture et composition ; pas de benchmark permettant d’évaluer la nouveauté |
| 2. Utile | 1 | E3/E4 : parcours réalisables, mais détours entre gestion, choix et insertion |
| 3. Esthétique | 1, provisoire | E6 : système commun, mais tailles et styles disparates ; rendu réel non inspecté |
| 4. Compréhensible | 1 | E1/E2/E5 : ressources, glyph, titre et boutons se recouvrent |
| 5. Discret | 2, provisoire | E1/E6 : panneau fermable et redimensionnable ; densité et technique exposée |
| 6. Honnête | 1 | E3/E5 : même apparence de catalogue, gestes différents et messages vides inexacts |
| 7. Durable | Non évalué | E6 : tokens réutilisables ; vieillissement esthétique non déductible de ce seul audit |
| 8. Soigné dans le détail | 1 | E5/E6 : états erreur/chargement et cohérence clavier incomplets |
| 9. Économe en ressources | Non évalué | E7 : optimisations existantes, mais pas de mesure JS/TTI/transferts |
| 10. Minimal | 1 | E1/E2 : catalogue répété, import répété et hiérarchie mélangeant rôles |

Sous-total des dimensions évaluées : 8/21. Aucun total /30 valide. Verdict qualitatif : REDESIGN ciblé de l’architecture bibliothèque/apparence, justifié par les dimensions fonctionnelles faibles. Ce verdict ne prescrit pas une refonte esthétique de tout l’éditeur.
