# Issue tracker: GitHub

This repository's tickets and PRDs live in GitHub Issues. Use `gh` for every operation.

## Conventions

- Create: `gh issue create --title "..." --body "..."`
- Read: `gh issue view <number> --comments`
- List: `gh issue list --state open --json number,title,body,labels,comments`
- Comment: `gh issue comment <number> --body "..."`
- Add or remove a label: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`
- Close: `gh issue close <number> --comment "..."`

The repository is inferred from the current Git remote.

When a skill asks to publish a ticket, create a GitHub Issue. When it asks to fetch a ticket, use `gh issue view <number> --comments`.
