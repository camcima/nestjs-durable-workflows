import StateMachine from 'javascript-state-machine';
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
  private readonly fsm: StateMachine;
  private readonly compiled = new Map<string, StateTransitions>();
  private readonly stateMachineTransitions: Array<{
    name: string;
    from: string;
    to: string;
  }> = [];
  private readonly transitions: RuntimeTransition[] = [];
  private readonly context: Record<string, unknown>;
  private status: WorkflowStatus;

  constructor(
    private readonly definition: DurableWorkflowDefinition,
    private readonly workflowId: string,
    snapshot: Record<string, unknown> | undefined,
    private readonly maxTransitionDepth: number,
  ) {
    const seed = hydrateSnapshot(workflowId, definition, snapshot);
    this.context = cloneContext(seed.context);
    this.status = seed.status;

    this.buildCompiledTransitions();

    this.fsm = new StateMachine({
      init: seed.state,
      transitions: this.stateMachineTransitions,
    });

    this.fsm.observe('onAfterTransition', (lifecycle) => {
      if (lifecycle.from !== lifecycle.to) {
        this.transitions.push({
          fromState: lifecycle.from,
          toState: lifecycle.to,
        });
      }
    });
  }

  async send(event: WorkflowEventPayload): Promise<RuntimeSendResult> {
    if (this.status === 'done') {
      return {
        stateValue: this.fsm.state,
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

    this.status = isFinalState(this.definition, this.fsm.state)
      ? 'done'
      : 'active';

    return {
      stateValue: this.fsm.state,
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
      stateValue: this.fsm.state,
      done: this.status === 'done',
      context: this.context,
    };
  }

  dehydrate() {
    return {
      schema: 'durable-workflow-snapshot' as const,
      version: 1 as const,
      engine: 'js-state-machine' as const,
      state: this.fsm.state,
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
        const compiledRules: CompiledTransition[] = rules.map((rule) => {
          const name = `tr${counter++}`;
          if (rule.target) {
            this.stateMachineTransitions.push({
              name,
              from: stateName,
              to: rule.target,
            });
          }
          return {
            name,
            from: stateName,
            to: rule.target,
            guard: rule.guard,
            actions: toActions(rule.actions),
          };
        });
        stateTransitions.on.set(eventType, compiledRules);
      }

      for (const ruleInput of toArray(stateDef.always)) {
        const rule = toConfig(ruleInput);
        const name = `tr${counter++}`;
        if (rule.target) {
          this.stateMachineTransitions.push({
            name,
            from: stateName,
            to: rule.target,
          });
        }

        stateTransitions.always.push({
          name,
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
    const current = this.compiled.get(this.fsm.state);
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
          this.fsm.state,
          this.fsm.state,
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
      fromState: this.fsm.state,
      toState: candidate.to ?? this.fsm.state,
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
    const fromState = this.fsm.state;

    await this.runActions(
      toActions(this.definition.states[fromState]?.exit),
      fromState,
      candidate.to ?? fromState,
      event,
    );

    const transitionFn = (this.fsm as Record<string, unknown>)[candidate.name];
    if (typeof transitionFn !== 'function') {
      throw new Error(
        `Compiled transition ${candidate.name} is not available on runtime machine`,
      );
    }

    await Promise.resolve(
      (transitionFn as (evt: WorkflowEventPayload) => unknown).call(
        this.fsm,
        event,
      ),
    );

    const toState = this.fsm.state;

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
