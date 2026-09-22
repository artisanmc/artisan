# Issue tracker: GitHub

Les tickets et PRD de ce dépôt vivent dans GitHub Issues. Utiliser `gh` pour toutes les opérations.

## Conventions

- Créer : `gh issue create --title "..." --body "..."`
- Lire : `gh issue view <number> --comments`
- Lister : `gh issue list --state open --json number,title,body,labels,comments`
- Commenter : `gh issue comment <number> --body "..."`
- Ajouter ou retirer un label : `gh issue edit <number> --add-label "..."` ou `--remove-label "..."`
- Fermer : `gh issue close <number> --comment "..."`

Le dépôt est déduit du remote Git courant.

Quand un skill demande de publier un ticket, créer une GitHub Issue. Quand il demande de récupérer un ticket, utiliser `gh issue view <number> --comments`.
