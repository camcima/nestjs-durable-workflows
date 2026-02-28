# JS State Machine Migration Spec

This document summarizes the runtime cutover from the previous workflow runtime to `javascript-state-machine`.

## Scope

- Introduce runtime engine abstraction (`IWorkflowEngine`)
- Use `JavascriptStateMachineEngine` as default runtime
- Replace workflow registration input with durable definitions
- Use V1 snapshot envelope only
- Preserve timeout, concurrency, and lifecycle-event behavior
- Remove production runtime dependency on the previous engine

## Detailed Planning Artifacts

The feature planning artifacts for this migration live under:

- `specs/001-replace-xstate-engine/spec.md`
- `specs/001-replace-xstate-engine/plan.md`
- `specs/001-replace-xstate-engine/research.md`
- `specs/001-replace-xstate-engine/data-model.md`
- `specs/001-replace-xstate-engine/contracts/workflow-runtime-api.openapi.yaml`
- `specs/001-replace-xstate-engine/tasks.md`
