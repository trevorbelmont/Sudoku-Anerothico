# Strict Principles: Preservation, Non-Regression & Additive Expansion

## 1. Zero Regression & Preservation Rule
- **NEVER** delete, omit, rewrite, simplify, or truncate existing code, text, comments, functions, classes, or application features unless explicitly instructed by the user to do so.
- **NEVER** leave placeholders like `// ... keep existing code ...`, `// TODO: rest of logic`, or partial stubs. When editing an existing file, all existing functionality must remain fully intact and operational.
- You must treat every existing feature and line of logic as mission-critical.

## 2. Additive & Non-Destructive Modifications
- When implementing a new feature, fixing a bug, or refactoring:
  - Add new modules, classes, functions, or configurations cleanly alongside existing code.
  - Integrate new code without breaking or modifying the external interface/contracts of existing components.
  - If a change is needed inside an existing function, make the minimal, surgical edit necessary to incorporate the enhancement while preserving 100% of the previous behavior and edge-case handling.

## 3. Explicit Approval for Deletions
- If you genuinely believe an existing feature, function, dependency, or file is redundant, broken, or blocking the new implementation, **DO NOT delete or replace it autonomously**.
- Instead, keep the existing implementation intact and explicitly ask the user for permission before removing or deprecating anything.

## 4. Verification Before Diff Completion
- Before finalizing any file edit:
  1. Verify that no existing methods, routes, states, or UI components were accidentally stripped out.
  2. Ensure that previously working features will continue to build and execute without regression.