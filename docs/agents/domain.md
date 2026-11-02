# Domain Docs

How engineering skills should consume this repository's domain documentation while exploring the codebase.

## Before exploring, read these

- `GLOSSARY.md` at the repository root, if it exists.
- `docs/adr/` entries that affect the area being changed, if they exist.

If these files do not exist, proceed silently. Do not suggest creating them upfront. The domain-modeling workflows create them lazily when terminology or architectural decisions are actually resolved.

## File structure

This is a single-context repository:

```text
/
├── GLOSSARY.md
├── docs/adr/
└── src/
```

## Use the glossary's vocabulary

When naming a domain concept in an issue, proposal, hypothesis, test, or implementation, use the term defined in `GLOSSARY.md`. Do not drift to synonyms the glossary explicitly avoids.

If a needed concept is absent, reconsider whether the term belongs to the project's language or note the gap for a domain-modeling workflow.

## Flag ADR conflicts

If proposed work contradicts an existing ADR, surface the conflict explicitly instead of silently overriding the decision.
