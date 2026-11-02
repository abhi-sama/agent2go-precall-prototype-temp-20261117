# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Repository

- **Repository:** `abhi-sama/agent2go`
- **Visibility:** private
- Infer the repository from `git remote -v`; `gh` does this automatically inside this checkout.

## Conventions

- **Create an issue:** `gh issue create --title "..." --body "..."`.
- **Read an issue:** `gh issue view <number> --json number,title,body,labels,comments`.
- **List issues:** `gh issue list --state open --json number,title,body,labels,comments` with suitable label and state filters.
- **Comment:** `gh issue comment <number> --body "..."`.
- **Apply or remove labels:** `gh issue edit <number> --add-label "..."` or `--remove-label "..."`.
- **Close:** post an explanatory comment, then run `gh issue close <number>`.
- **Sub-issues:** use GitHub's native sub-issue relationship when available. Otherwise, put `Part of #<parent>` at the top of the child issue.
- **Blocking:** use GitHub's native issue dependencies when available. Otherwise, put `Blocked by: #<number>` at the top of the blocked issue.

Before the first issue write in a session, verify the target using `gh repo view --json nameWithOwner`. File issues only in the user's repository, never in the repository that supplied an installed skill.

## Pull requests as a triage surface

**PRs as a request surface: no.**

GitHub shares one number space across issues and pull requests. If a bare issue number is ambiguous, try `gh pr view <number>` and then `gh issue view <number>`.

## Skill terminology

- When a skill says **publish to the issue tracker**, create a GitHub issue.
- When a skill says **fetch the relevant ticket**, read the corresponding GitHub issue.

## Wayfinding operations

The `/wayfinder` map is a GitHub issue with child issues as tickets.

- Label the map `wayfinder:map`.
- Link tickets as native sub-issues where available.
- Label tickets `wayfinder:<type>`, where type is `research`, `prototype`, `grilling`, or `task`.
- Treat a ticket as startable only when it has no open blocker and no assignee.
- Claim a ticket by assigning it to the driving developer.
- Resolve a ticket by commenting with the answer, closing it, and recording the resulting context pointer in the map.
