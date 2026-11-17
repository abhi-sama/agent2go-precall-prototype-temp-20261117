# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Medical Science Liaisons preparing immediately before an authorized scientific exchange with a healthcare professional.

## Product Purpose

MSL Agent turns authorized HCP history into a concise, evidence-linked pre-call brief so an MSL can enter a meeting oriented to the objective, prior scientific exchange, recorded perspectives, open questions, and missing information.

## Positioning

Every synthesized statement remains inspectable against the exact authorized call activity or recorded insight that supports it; the agent writes the narrative but does not invent the evidence.

## Operating Context

The brief is used shortly before an HCP meeting, often under time pressure and on both desktop and mobile. The user needs a fast first read, the ability to inspect earlier interactions, and a printable or downloadable PDF for offline review.

## Capabilities and Constraints

- Evidence is gathered deterministically from authorized `call_activity` and `hcp_raw_insights` records.
- The brief includes HCP identity and scope, the call objective, previous engagement, recorded perspectives, possible follow-ups, discussion prompts, missing information, and supporting records.
- Every AI-authored claim links to its supporting record.
- Suggestions remain visibly distinct from recorded facts.
- The interface must support Print / Save PDF.
- Demonstration HCP data must be labeled illustrative and must not be presented as real PHI.
- This exploration is isolated from the production `/msl/briefs` route.

## Evidence on Hand

- Repository architecture decisions and the existing pre-call brief implementation.
- Existing mock records for call activity and HCP insights.
- User-provided screenshots of the current generated brief and a Markdown export used only as content reference.
- No verified commercial claims, patient outcomes, or external HCP profile data are available and none may be fabricated.

## Product Principles

- Prepare the MSL for the next conversation, not for database administration.
- Make the evidence trail obvious without letting citations dominate the first read.
- Separate recorded truth, AI synthesis, suggestions, and missing information.
- Reveal detail progressively so a two-minute scan and a deep review both work.
- Preserve authorization and provenance at every level.

## Accessibility & Inclusion

Keyboard navigation, visible focus, semantic structure, reduced-motion support, readable contrast, and mobile reflow are required for the prototype.
