<!--
Sync Impact Report
- Version change: 1.0.0 → 1.0.1
- Bump rationale: PATCH. No principle changed. The 1.0.0 report claimed
  .specify/templates/tasks-template.md had been updated to make tests mandatory.
  That edit was never made — the core template still reads "Tests are OPTIONAL".
  This amendment corrects the record and points at the override that actually
  implements the change.
- Modified principles: none
  - I. Test-Driven Development (NON-NEGOTIABLE) — unchanged
  - II. End-to-End Coverage for Every Feature — unchanged
  - III. Agent-Testable by Design — unchanged
  - IV. Simplicity Over Enterprise Rigor — unchanged
  - V. No Backwards-Compatibility Guarantees — unchanged
- Added sections: none
- Removed sections: none
- Templates requiring updates:
  - ✅ .specify/templates/plan-template.md (Constitution Check references generic gates resolved dynamically; consistent, no change required)
  - ✅ .specify/templates/spec-template.md (no principle-specific mandatory sections referenced; consistent)
  - ✅ .specify/templates/overrides/tasks-template.md (ADDED: project override making tests
       MANDATORY per Principle I and adding a required E2E task per user story per Principle II.
       resolve_template() in .specify/scripts/bash/common.sh checks overrides/ first, so this
       file — not the core template — is what /speckit-tasks consumes. The stock
       .specify/templates/tasks-template.md is intentionally left untouched so it stays
       upgrade-safe.)
  - ✅ .claude/skills/*/commands (no agent-specific naming conflicts found)
- Follow-up TODOs: none
-->

# Worksite Constitution

## Core Principles

### I. Test-Driven Development (NON-NEGOTIABLE)
All code MUST be written test-first: write a failing test that specifies the
desired behavior, confirm it fails, then write the minimum implementation
code to make it pass, then refactor. Implementation code MUST NOT be written
before a corresponding failing test exists. Red-Green-Refactor is the only
accepted workflow for writing logic.
Rationale: TDD is the primary correctness guarantee on this project — most
implementation is done by AI agents, and a test-first discipline is what
keeps that work verifiable and honest.

### II. End-to-End Coverage for Every Feature
Every user-facing feature MUST have an end-to-end test that exercises it the
way a real user or agent would, in addition to the unit/integration tests
produced by TDD. A feature is not considered done until its E2E test exists
and passes. Manual, one-off verification MUST be converted into an
automated E2E test before the feature is marked complete.
Rationale: unit tests catch logic errors but miss integration and workflow
failures; the E2E suite is the final gate that a feature actually works.

### III. Agent-Testable by Design
Interfaces (CLIs, APIs, UI hooks, test IDs, fixtures) MUST be designed so an
automated agent can drive them end-to-end without special tooling or a
human in the loop: deterministic setup/teardown, scriptable entry points,
machine-readable output, and stable selectors are required. Test suites
MUST be runnable via a single documented command.
Rationale: this project is built and tested primarily by AI agents — if an
agent can't drive a feature unattended, E2E coverage for it won't get
written or kept up to date.

### IV. Simplicity Over Enterprise Rigor
This is a personal project. Always choose the simplest solution that works
over enterprise-grade patterns — elaborate abstraction layers, multi-
environment configuration, defensive extensibility — unless a concrete,
present requirement demands it. YAGNI applies by default; complexity MUST
be justified by an actual need, not a hypothetical one.
Rationale: there is no team or scale to amortize enterprise overhead
against, so that overhead is pure cost.

### V. No Backwards-Compatibility Guarantees
Releases MAY introduce breaking changes freely. There is no obligation to
maintain backwards compatibility, deprecation windows, or migration paths
between versions.
Rationale: without external consumers depending on stability, compatibility
guarantees would only slow down iteration for no benefit.

## Testing & Quality Gates

- A feature's unit/integration tests (from TDD) and its E2E test MUST all
  pass before the feature is considered complete.
- The full test suite (unit, integration, and E2E) MUST be runnable with a
  single documented command so an agent can execute it unattended.
- Flaky tests MUST be fixed or deleted immediately; they MUST NOT be left
  skipped or ignored.

## Development Workflow

- Workflow per feature: write a failing test → implement the minimum code
  to pass → refactor → add/extend the E2E test for the feature → run the
  full suite.
- Keep tooling and dependencies minimal; add a new dependency, service, or
  abstraction only when the current approach demonstrably cannot satisfy
  the requirement at hand.

## Governance

This constitution supersedes ad-hoc practices. Any deviation from it MUST
be called out and justified in the relevant commit or task description.

Amendments are made by editing this file, incrementing the version per the
semantic versioning policy below, and recording the change in a Sync Impact
Report comment at the top of this file.

Versioning policy:
- MAJOR: a principle is removed or redefined in a backward-incompatible way.
- MINOR: a new principle or section is added, or existing guidance is
  materially expanded.
- PATCH: wording, clarification, or other non-semantic refinement.

Compliance: since this project has no formal review process, whoever (or
whichever agent) implements a change is responsible for self-checking
compliance with this constitution before calling the work complete. Use
CLAUDE.md for day-to-day runtime development guidance.

**Version**: 1.0.1 | **Ratified**: 2026-07-09 | **Last Amended**: 2026-08-09
