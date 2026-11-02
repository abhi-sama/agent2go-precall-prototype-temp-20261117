# Agent instructions

## Grilling interaction

Whenever a skill or workflow grills the user, ask exactly one follow-up question at a time using the client's interactive choice UI whenever it is available.

- In Codex, use the interactive user-input selection tool when it is available.
- In Claude Code, use `AskUserQuestion`.
- Offer two or three mutually exclusive choices, put the recommended choice first, and explain each choice in one short sentence.
- After the user selects an answer, continue with the next question in the same interactive format until the grilling workflow is complete.
- Use free-form input only when the decision cannot be represented by useful choices.
- If the client cannot display an interactive choice UI, ask one concise numbered-choice question in chat and continue sequentially.

## Agent skills

### Issue tracker

Issues and specs are tracked in GitHub Issues for `abhi-sama/agent2go`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the five default Matt Pocock triage labels. See `docs/agents/triage-labels.md`.

### Domain docs

This repository uses the single-context domain-documentation layout. See `docs/agents/domain.md`.
