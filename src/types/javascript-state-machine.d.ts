declare module 'javascript-state-machine' {
  interface Lifecycle {
    transition: string;
    from: string;
    to: string;
  }

  interface Transition {
    name: string;
    from: string | string[];
    to: string;
  }

  interface Config {
    init: string;
    transitions: Transition[];
  }

  class StateMachine {
    constructor(config: Config);
    state: string;
    can(transition: string): boolean;
    observe(event: string, fn: (lifecycle: Lifecycle) => void): void;
    [key: string]: unknown;
  }

  export = StateMachine;
}
