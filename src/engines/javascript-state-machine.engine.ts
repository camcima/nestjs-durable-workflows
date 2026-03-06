import { RecursiveTransitionError } from '../errors/recursive-transition.error';
import type {
  DurableWorkflowDefinition,
  TransitionConfig,
  TransitionRule,
  WorkflowAction,
  WorkflowActionInput,
  WorkflowEventPayload,
  WorkflowStatus,
} from '../interfaces/durable-workflow-definition.interface';
import type {
  CreateRuntimeInput,
  IWorkflowEngine,
  IWorkflowRuntime,
  RuntimeSendResult,
  RuntimeTransition,
} from '../interfaces/workflow-engine.interface';
import { hydrateSnapshot, isFinalState } from '../utils/hydrate-snapshot';
import { validateWorkflowDefinition } from '../utils/validate-workflow-definition';

interface CompiledTransition {
  name: string;
  from: string;
  to?: string;
  guard?: (input: WorkflowActionInput) => boolean;
  actions: WorkflowAction[];
}

interface StateTransitions {
  on: Map<string, CompiledTransition[]>;
  always: CompiledTransition[];
}

const ALWAYS_EVENT = '__always__';

function toArray<T>(value?: T | T[]): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function toConfig(rule: TransitionRule): TransitionConfig {
  return typeof rule === 'string' ? { target: rule } : rule;
}

function toActions(
  action?: WorkflowAction | WorkflowAction[],
): WorkflowAction[] {
  return toArray(action);
}

function cloneContext(
  context: Record<string, unknown>,
): Record<string, unknown> {
  return JSON.parse(JSON.stringify(context)) as Record<string, unknown>;
}

class JavascriptStateMachineRuntime implements IWorkflowRuntime {
  private readonly compiled = new Map<string, StateTransitions>();
  private readonly transitions: RuntimeTransition[] = [];
  private readonly context: Record<string, unknown>;
  private status: WorkflowStatus;
  private currentState: string;

  constructor(
    private readonly definition: DurableWorkflowDefinition,
    private readonly workflowId: string,
    snapshot: Record<string, unknown> | undefined,
    private readonly maxTransitionDepth: number,
  ) {
    const seed = hydrateSnapshot(workflowId, definition, snapshot);
    this.context = cloneContext(seed.context);
    this.status = seed.status;
    this.currentState = seed.state;

    this.buildCompiledTransitions();
  }

  async send(event: WorkflowEventPayload): Promise<RuntimeSendResult> {
    if (this.status === 'done') {
      return {
        stateValue: this.currentState,
        done: true,
        transitions: [],
      };
    }

    this.transitions.length = 0;
    let depth = 0;

    await this.processEvent(event.type, event, () => {
      depth += 1;
      if (depth > this.maxTransitionDepth) {
        throw new RecursiveTransitionError(
          this.workflowId,
          depth,
          this.maxTransitionDepth,
        );
      }
    });

    while (
      await this.processEvent(ALWAYS_EVENT, event, () => {
        depth += 1;
        if (depth > this.maxTransitionDepth) {
          throw new RecursiveTransitionError(
            this.workflowId,
            depth,
            this.maxTransitionDepth,
          );
        }
      })
    ) {
      // drain internal transitions until stable
    }

    this.status = isFinalState(this.definition, this.currentState)
      ? 'done'
      : 'active';

    return {
      stateValue: this.currentState,
      done: this.status === 'done',
      transitions: [...this.transitions],
    };
  }

  getSnapshot(): {
    stateValue: string;
    done: boolean;
    context: Record<string, unknown>;
  } {
    return {
      stateValue: this.currentState,
      done: this.status === 'done',
      context: this.context,
    };
  }

  dehydrate() {
    return {
      schema: 'durable-workflow-snapshot' as const,
      version: 1 as const,
      engine: 'xstate' as const,
      state: this.currentState,
      status: this.status,
      context: this.context,
    };
  }

  private buildCompiledTransitions(): void {
    let counter = 0;

    for (const [stateName, stateDef] of Object.entries(
      this.definition.states,
    )) {
      const stateTransitions: StateTransitions = {
        on: new Map<string, CompiledTransition[]>(),
        always: [],
      };

      for (const [eventType, rulesInput] of Object.entries(stateDef.on ?? {})) {
        const rules = toArray(rulesInput).map(toConfig);
        const compiledRules: CompiledTransition[] = rules.map((rule) => ({
          name: `tr${counter++}`,
          from: stateName,
          to: rule.target,
          guard: rule.guard,
          actions: toActions(rule.actions),
        }));
        stateTransitions.on.set(eventType, compiledRules);
      }

      for (const ruleInput of toArray(stateDef.always)) {
        const rule = toConfig(ruleInput);
        stateTransitions.always.push({
          name: `tr${counter++}`,
          from: stateName,
          to: rule.target,
          guard: rule.guard,
          actions: toActions(rule.actions),
        });
      }

      this.compiled.set(stateName, stateTransitions);
    }
  }

  private async processEvent(
    eventType: string,
    event: WorkflowEventPayload,
    onStateTransition: () => void,
  ): Promise<boolean> {
    const current = this.compiled.get(this.currentState);
    if (!current) return false;

    const candidates =
      eventType === ALWAYS_EVENT
        ? current.always
        : (current.on.get(eventType) ?? []);

    for (const candidate of candidates) {
      if (!this.passesGuard(candidate, event)) {
        continue;
      }

      if (!candidate.to) {
        await this.runActions(
          candidate.actions,
          this.currentState,
          this.currentState,
          event,
        );
        return false;
      }

      onStateTransition();
      await this.runStateTransition(candidate, event);
      return true;
    }

    return false;
  }

  private passesGuard(
    candidate: CompiledTransition,
    event: WorkflowEventPayload,
  ): boolean {
    if (!candidate.guard) {
      return true;
    }

    const result = candidate.guard({
      context: this.context,
      event,
      fromState: this.currentState,
      toState: candidate.to ?? this.currentState,
    });

    if (typeof result !== 'boolean') {
      throw new Error(
        `Guard for workflow ${this.workflowId} must return a synchronous boolean value`,
      );
    }

    return result;
  }

  private async runStateTransition(
    candidate: CompiledTransition,
    event: WorkflowEventPayload,
  ): Promise<void> {
    const fromState = this.currentState;

    await this.runActions(
      toActions(this.definition.states[fromState]?.exit),
      fromState,
      candidate.to ?? fromState,
      event,
    );

    this.currentState = candidate.to ?? fromState;
    const toState = this.currentState;

    if (fromState !== toState) {
      this.transitions.push({
        fromState,
        toState,
      });
    }

    await this.runActions(candidate.actions, fromState, toState, event);

    if (fromState !== toState) {
      await this.runActions(
        toActions(this.definition.states[toState]?.entry),
        fromState,
        toState,
        event,
      );
    }
  }

  private async runActions(
    actions: WorkflowAction[],
    fromState: string,
    toState: string,
    event: WorkflowEventPayload,
  ): Promise<void> {
    for (const action of actions) {
      await action({
        context: this.context,
        event,
        fromState,
        toState,
      });
    }
  }
}

export class JavascriptStateMachineEngine implements IWorkflowEngine {
  createRuntime(input: CreateRuntimeInput): IWorkflowRuntime {
    validateWorkflowDefinition(input.definition);

    return new JavascriptStateMachineRuntime(
      input.definition,
      input.workflowId,
      input.snapshot,
      input.maxTransitionDepth,
    );
  }
}
