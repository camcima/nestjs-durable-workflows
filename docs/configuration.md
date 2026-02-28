# Configuration

## Module Registration

### `forRoot`

```ts
WorkflowModule.forRoot({
  adapter: new DrizzleWorkflowAdapter(db, 'workflows'),
  cronExpression: '*/60 * * * * *',
  timeoutEventType: 'TIMEOUT',
  enableTimeoutCron: true,
  maxTransitionDepth: 100,
});
```

### `forRootAsync`

```ts
WorkflowModule.forRootAsync({
  imports: [ConfigModule],
  useFactory: (config: ConfigService, db: any) => ({
    adapter: new DrizzleWorkflowAdapter(db, 'workflows'),
    cronExpression: config.get('WORKFLOW_CRON', '*/60 * * * * *'),
    timeoutEventType: config.get('WORKFLOW_TIMEOUT_EVENT', 'TIMEOUT'),
    enableTimeoutCron: config.get('WORKFLOW_ENABLE_CRON', true),
    maxTransitionDepth: config.get('WORKFLOW_MAX_DEPTH', 100),
  }),
  inject: [ConfigService, DATABASE_CONNECTION],
});
```

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `adapter` | `IWorkflowDbAdapter` | required | Persistence adapter |
| `engine` | `IWorkflowEngine` | `JavascriptStateMachineEngine` | Runtime engine override |
| `cronExpression` | `string` | `*/60 * * * * *` | Timeout cron expression |
| `timeoutEventType` | `string` | `TIMEOUT` | Timeout event type |
| `enableTimeoutCron` | `boolean` | `true` | Enable internal timeout cron |
| `maxTransitionDepth` | `number` | `100` | Recursive transition safety limit |

## Workflow Registration

Decorate workflow providers with durable definitions.

```ts
@WorkflowEntity({ definition: orderDefinition })
@Injectable()
export class OrderWorkflow {}
```

Optional explicit table name:

```ts
@WorkflowEntity({ tableName: 'orders', definition: orderDefinition })
```

## Constants

- `WORKFLOW_MODULE_OPTIONS`
- `WORKFLOW_DB_ADAPTER`
- `WORKFLOW_ENGINE`
- `DEFAULT_CRON_EXPRESSION`
- `DEFAULT_TIMEOUT_EVENT`
- `DEFAULT_MAX_DEPTH`
- `WORKFLOW_ENTITY_METADATA`
