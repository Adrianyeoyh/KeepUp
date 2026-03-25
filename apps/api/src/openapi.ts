const jsonValueSchema = {
  oneOf: [
    { type: 'string' },
    { type: 'number' },
    { type: 'integer' },
    { type: 'boolean' },
    { type: 'array', items: {} },
    { type: 'object', additionalProperties: true },
  ],
  nullable: true,
};

const jsonObjectSchema = {
  type: 'object',
  additionalProperties: true,
};

const idSchema = {
  type: 'string',
  format: 'uuid',
};

const dateSchema = {
  type: 'string',
  format: 'date',
};

const dateTimeSchema = {
  type: 'string',
  format: 'date-time',
};

const stringArraySchema = {
  type: 'array',
  items: { type: 'string' },
};

const apiSecurity = [{ BearerAuth: [] }, { ApiKeyAuth: [] }];
const adminSecurity = [{ AdminKeyAuth: [] }];
const slackSecurity = [{ SlackSignature: [], SlackTimestamp: [] }];
const githubSecurity = [{ GitHubWebhookSignature: [] }];
const jiraSecurity = [{ JiraWebhookSignature: [] }];

function ref(name: string) {
  return { $ref: `#/components/schemas/${name}` };
}

function arrayOf(schema: Record<string, unknown>) {
  return {
    type: 'array',
    items: schema,
  };
}

function response(description: string, schema: Record<string, unknown>, example?: unknown) {
  return {
    description,
    content: {
      'application/json': {
        schema,
        ...(example === undefined ? {} : { example }),
      },
    },
  };
}

function errorResponses(...codes: string[]) {
  return Object.fromEntries(
    codes.map((code) => [code, response('Error response', ref('ErrorResponse'))]),
  );
}

function uuidPathParam(name: string, description: string) {
  return {
    name,
    in: 'path',
    required: true,
    description,
    schema: idSchema,
  };
}

function stringPathParam(name: string, description: string, enumValues?: string[]) {
  return {
    name,
    in: 'path',
    required: true,
    description,
    schema: enumValues ? { type: 'string', enum: enumValues } : { type: 'string' },
  };
}

function queryParam(
  name: string,
  description: string,
  schema: Record<string, unknown>,
  required = false,
) {
  return {
    name,
    in: 'query',
    required,
    description,
    schema,
  };
}

export function buildOpenApiDocument(serverUrl: string) {
  return {
    openapi: '3.0.3',
    info: {
      title: 'FlowGuard API',
      version: '0.1.0',
      description: [
        'FlowGuard exposes operational-intelligence APIs for dashboard analytics, leak analysis, approvals, ledger graph workflows, integrations, and webhook ingestion.',
        '',
        'Interactive documentation is available at `/docs/swagger` on the running API server.',
      ].join('\n'),
    },
    servers: [
      {
        url: serverUrl,
        description: 'Active FlowGuard API server',
      },
    ],
    tags: [
      { name: 'Public', description: 'Unauthenticated health and documentation endpoints.' },
      { name: 'Dashboard', description: 'High-level overview endpoints used by the dashboard home views.' },
      { name: 'Leaks', description: 'Leak discovery, context, traceability, and feedback APIs.' },
      { name: 'Approvals', description: 'Proposed remediation approvals and execution history.' },
      { name: 'Ledger', description: 'Ledger commit lists, graph traversal, and promotion flows.' },
      { name: 'Ledger Routes', description: 'Persisted graph routes and review dispatch workflows.' },
      { name: 'Metrics', description: 'Time-series metrics and team comparison APIs.' },
      { name: 'Entities', description: 'Entity link graph, connected entities, and inferred links.' },
      { name: 'Inference', description: 'AI-assisted entity inference APIs.' },
      { name: 'Teams', description: 'Team CRUD and team-specific leak-rule endpoints.' },
      { name: 'Projects', description: 'Project CRUD, activity graph, and sync helpers.' },
      { name: 'Settings', description: 'Company configuration, integration summaries, and health details.' },
      { name: 'Admin', description: 'Admin bootstrap and integration-management APIs secured by x-admin-key.' },
      { name: 'Webhooks', description: 'Slack, Jira, and GitHub webhook ingestion endpoints.' },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'API key',
          description: 'Dashboard auth via Authorization: Bearer <ADMIN_API_KEY>.',
        },
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key',
          description: 'Dashboard auth via x-api-key header.',
        },
        AdminKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'x-admin-key',
          description: 'Admin auth used for bootstrap and integration management.',
        },
        SlackSignature: {
          type: 'apiKey',
          in: 'header',
          name: 'x-slack-signature',
          description: 'Slack request signature. Required when SLACK_SIGNING_SECRET is configured.',
        },
        SlackTimestamp: {
          type: 'apiKey',
          in: 'header',
          name: 'x-slack-request-timestamp',
          description: 'Slack request timestamp used for replay protection.',
        },
        GitHubWebhookSignature: {
          type: 'apiKey',
          in: 'header',
          name: 'x-hub-signature-256',
          description: 'GitHub webhook HMAC signature. Required when GITHUB_WEBHOOK_SECRET is configured.',
        },
        JiraWebhookSignature: {
          type: 'apiKey',
          in: 'header',
          name: 'x-atlassian-webhook-signature',
          description: 'Jira webhook signature. The API also accepts x-hub-signature or x-hub-signature-256.',
        },
      },
      schemas: {
        ErrorResponse: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
          required: ['error'],
        },
        HealthResponse: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            timestamp: dateTimeSchema,
            version: { type: 'string' },
            services: {
              type: 'object',
              properties: {
                database: { type: 'string' },
              },
              additionalProperties: true,
            },
          },
          required: ['status', 'timestamp'],
        },
        Company: {
          type: 'object',
          properties: {
            id: idSchema,
            name: { type: 'string' },
            slug: { type: 'string' },
            settings: jsonObjectSchema,
            created_at: dateTimeSchema,
            updated_at: dateTimeSchema,
          },
          required: ['id', 'name'],
        },
        Integration: {
          type: 'object',
          properties: {
            id: idSchema,
            company_id: idSchema,
            provider: { type: 'string', enum: ['slack', 'jira', 'github', 'zendesk'] },
            status: { type: 'string', enum: ['pending', 'active', 'error', 'revoked'] },
            installation_data: jsonObjectSchema,
            token_keys: stringArraySchema,
            scopes: stringArraySchema,
            webhook_secret_configured: { type: 'boolean' },
            updated_at: dateTimeSchema,
            created_at: dateTimeSchema,
          },
          required: ['id', 'provider', 'status'],
        },
        LeakInstance: {
          type: 'object',
          properties: {
            id: idSchema,
            company_id: idSchema,
            team_id: { ...idSchema, nullable: true },
            project_id: { ...idSchema, nullable: true },
            leak_type: { type: 'string' },
            severity: { type: 'integer' },
            confidence: { type: 'number' },
            status: { type: 'string' },
            detected_at: dateTimeSchema,
            cost_estimate_hours_per_week: { type: 'number', nullable: true },
            evidence_links: arrayOf(jsonObjectSchema),
            metrics_context: jsonObjectSchema,
            recommended_fix: jsonObjectSchema,
            ai_diagnosis: jsonObjectSchema,
            created_at: dateTimeSchema,
            updated_at: dateTimeSchema,
          },
          required: ['id', 'leak_type', 'severity', 'confidence', 'status', 'detected_at'],
        },
        ProposedAction: {
          type: 'object',
          properties: {
            id: idSchema,
            company_id: idSchema,
            leak_instance_id: { ...idSchema, nullable: true },
            team_id: { ...idSchema, nullable: true },
            action_type: { type: 'string' },
            target_system: { type: 'string', enum: ['slack', 'jira', 'github'] },
            target_id: { type: 'string' },
            preview_diff: jsonObjectSchema,
            risk_level: { type: 'string', enum: ['low', 'medium', 'high'] },
            blast_radius: { type: 'string', nullable: true },
            approval_status: { type: 'string' },
            requested_by: { type: 'string', nullable: true },
            approved_by: { type: 'string', nullable: true },
            approved_at: { ...dateTimeSchema, nullable: true },
            created_at: dateTimeSchema,
            updated_at: dateTimeSchema,
          },
          required: ['id', 'action_type', 'target_system', 'target_id', 'approval_status'],
        },
        ExecutedAction: {
          type: 'object',
          properties: {
            id: idSchema,
            company_id: idSchema,
            proposed_action_id: idSchema,
            executed_at: dateTimeSchema,
            result: { type: 'string' },
            execution_details: jsonObjectSchema,
            rollback_info: jsonObjectSchema,
            audit_log: arrayOf(jsonObjectSchema),
            created_at: dateTimeSchema,
          },
          required: ['id', 'proposed_action_id', 'executed_at', 'result'],
        },
        LedgerCommit: {
          type: 'object',
          properties: {
            id: idSchema,
            company_id: idSchema,
            team_id: { ...idSchema, nullable: true },
            project_id: { ...idSchema, nullable: true },
            leak_instance_id: { ...idSchema, nullable: true },
            parent_commit_id: { ...idSchema, nullable: true },
            promoted_from: { ...idSchema, nullable: true },
            commit_type: { type: 'string' },
            scope_level: { type: 'string', enum: ['org', 'team', 'project'] },
            title: { type: 'string' },
            summary: { type: 'string' },
            rationale: { type: 'string', nullable: true },
            dri: { type: 'string', nullable: true },
            status: { type: 'string' },
            branch_name: { type: 'string' },
            evidence_links: arrayOf(jsonObjectSchema),
            tags: stringArraySchema,
            created_by: { type: 'string', nullable: true },
            approved_by: { type: 'string', nullable: true },
            approved_at: { ...dateTimeSchema, nullable: true },
            created_at: dateTimeSchema,
            updated_at: dateTimeSchema,
          },
          required: ['id', 'commit_type', 'title', 'status', 'created_at'],
        },
        LedgerRoute: {
          type: 'object',
          properties: {
            id: idSchema,
            company_id: idSchema,
            team_id: { ...idSchema, nullable: true },
            project_id: { ...idSchema, nullable: true },
            name: { type: 'string' },
            solution_draft: { type: 'string', nullable: true },
            snapshot: jsonObjectSchema,
            dataset_signature: { type: 'string' },
            focus_node_ids: stringArraySchema,
            created_by: { type: 'string', nullable: true },
            status: { type: 'string', enum: ['active', 'archived'] },
            created_at: dateTimeSchema,
            updated_at: dateTimeSchema,
          },
          required: ['id', 'name', 'snapshot', 'dataset_signature', 'status'],
        },
        LedgerRouteDispatch: {
          type: 'object',
          properties: {
            id: idSchema,
            ledger_route_id: idSchema,
            company_id: idSchema,
            provider: { type: 'string', enum: ['slack', 'jira', 'github'] },
            target: { type: 'string' },
            status: { type: 'string', enum: ['sent', 'failed'] },
            message: { type: 'string', nullable: true },
            response: jsonObjectSchema,
            error: { type: 'string', nullable: true },
            dispatched_by: { type: 'string', nullable: true },
            created_at: dateTimeSchema,
          },
          required: ['id', 'ledger_route_id', 'provider', 'target', 'status', 'created_at'],
        },
        Team: {
          type: 'object',
          properties: {
            id: idSchema,
            company_id: idSchema,
            name: { type: 'string' },
            slug: { type: 'string' },
            description: { type: 'string', nullable: true },
            lead_user_id: { type: 'string', nullable: true },
            color: { type: 'string', nullable: true },
            icon: { type: 'string', nullable: true },
            custom_leak_rules: arrayOf(jsonObjectSchema),
            created_at: dateTimeSchema,
            updated_at: dateTimeSchema,
          },
          required: ['id', 'name', 'slug'],
        },
        Project: {
          type: 'object',
          properties: {
            id: idSchema,
            company_id: idSchema,
            team_id: { ...idSchema, nullable: true },
            name: { type: 'string' },
            slug: { type: 'string' },
            description: { type: 'string', nullable: true },
            jira_project_keys: stringArraySchema,
            github_repos: stringArraySchema,
            slack_channel_ids: stringArraySchema,
            status: { type: 'string', enum: ['active', 'completed', 'archived'] },
            start_date: { ...dateSchema, nullable: true },
            target_date: { ...dateSchema, nullable: true },
            settings: jsonObjectSchema,
            created_at: dateTimeSchema,
            updated_at: dateTimeSchema,
          },
          required: ['id', 'name', 'slug', 'status'],
        },
        Event: {
          type: 'object',
          properties: {
            id: idSchema,
            company_id: idSchema,
            team_id: { ...idSchema, nullable: true },
            project_id: { ...idSchema, nullable: true },
            source: { type: 'string' },
            entity_id: { type: 'string' },
            event_type: { type: 'string' },
            timestamp: dateTimeSchema,
            metadata: jsonObjectSchema,
            provider_event_id: { type: 'string' },
            created_at: dateTimeSchema,
          },
          required: ['id', 'source', 'entity_id', 'event_type', 'timestamp'],
        },
        MetricSnapshot: {
          type: 'object',
          properties: {
            id: idSchema,
            company_id: idSchema,
            metric_name: { type: 'string' },
            scope: { type: 'string' },
            scope_id: { type: 'string', nullable: true },
            value: { type: 'number' },
            baseline_value: { type: 'number', nullable: true },
            date: dateSchema,
            metadata: jsonObjectSchema,
            created_at: dateTimeSchema,
          },
          required: ['id', 'metric_name', 'scope', 'value', 'date'],
        },
        EntityLink: {
          type: 'object',
          properties: {
            id: idSchema,
            company_id: idSchema,
            source_provider: { type: 'string' },
            source_entity_type: { type: 'string' },
            source_entity_id: { type: 'string' },
            target_provider: { type: 'string' },
            target_entity_type: { type: 'string' },
            target_entity_id: { type: 'string' },
            link_type: { type: 'string' },
            confidence: { type: 'number' },
            detected_by: { type: 'string' },
            metadata: jsonObjectSchema,
            created_at: dateTimeSchema,
          },
          required: ['id', 'source_provider', 'source_entity_id', 'target_provider', 'target_entity_id', 'link_type'],
        },
        InferredLink: {
          type: 'object',
          properties: {
            id: idSchema,
            source_provider: { type: 'string' },
            source_entity_type: { type: 'string', nullable: true },
            source_entity_id: { type: 'string' },
            target_provider: { type: 'string' },
            target_entity_type: { type: 'string', nullable: true },
            target_entity_id: { type: 'string' },
            confidence: { type: 'number' },
            confidence_tier: { type: 'string', enum: ['explicit', 'strong', 'medium', 'weak'] },
            inference_reason: arrayOf(jsonObjectSchema),
            status: { type: 'string', enum: ['suggested', 'confirmed', 'dismissed', 'expired'] },
            team_id: { ...idSchema, nullable: true },
            created_at: dateTimeSchema,
            updated_at: { ...dateTimeSchema, nullable: true },
          },
          required: ['id', 'source_provider', 'source_entity_id', 'target_provider', 'target_entity_id', 'confidence', 'status'],
        },
      },
    },
    paths: {
      '/health': {
        get: {
          tags: ['Public'],
          summary: 'Basic API health check',
          description: 'Verifies the API process is alive and the database connection can respond.',
          responses: {
            '200': response('Healthy API status', ref('HealthResponse')),
            '503': response('Unhealthy API status', ref('HealthResponse')),
          },
        },
      },
      '/docs/openapi.json': {
        get: {
          tags: ['Public'],
          summary: 'OpenAPI document',
          description: 'Returns the generated OpenAPI document that powers the Swagger UI.',
          responses: {
            '200': response('OpenAPI document', jsonObjectSchema),
          },
        },
      },
      '/api/dashboard/overview': {
        get: {
          tags: ['Dashboard'],
          summary: 'Dashboard overview',
          description: 'Returns the primary dashboard payload including company info, leak counts, event counts, integration status, recent leaks, commit summaries, and action summaries. Supports optional team or project scoping.',
          security: apiSecurity,
          parameters: [
            queryParam('team_id', 'Optional team scope filter.', idSchema),
            queryParam('project_id', 'Optional project scope filter.', idSchema),
          ],
          responses: {
            '200': response('Dashboard overview payload', jsonObjectSchema),
            ...errorResponses('500'),
          },
        },
      },
      '/api/overview': {
        get: {
          tags: ['Dashboard'],
          summary: 'Compact overview summary',
          description: 'Returns a lightweight summary of company, leak, event, and integration counts.',
          security: apiSecurity,
          responses: {
            '200': response('Compact overview payload', jsonObjectSchema),
            ...errorResponses('500'),
          },
        },
      },
      '/api/health/detailed': {
        get: {
          tags: ['Settings'],
          summary: 'Detailed health status',
          description: 'Returns database availability plus high-level table counts for companies, events, and leaks.',
          security: apiSecurity,
          responses: {
            '200': response('Detailed health payload', jsonObjectSchema),
            ...errorResponses('500'),
          },
        },
      },
      '/api/leaks': {
        get: {
          tags: ['Leaks'],
          summary: 'List leak instances',
          description: 'Returns paginated leak instances with optional status, type, team, project, and recency filters.',
          security: apiSecurity,
          parameters: [
            queryParam('page', 'Page number.', { type: 'integer', minimum: 1, default: 1 }),
            queryParam('limit', 'Page size.', { type: 'integer', minimum: 1, maximum: 50, default: 20 }),
            queryParam('status', 'Filter by leak status.', { type: 'string' }),
            queryParam('leak_type', 'Filter by leak type.', { type: 'string' }),
            queryParam('team_id', 'Optional team scope filter.', idSchema),
            queryParam('project_id', 'Optional project scope filter.', idSchema),
            queryParam('days', 'Limit leaks to the last N days.', { type: 'integer', minimum: 1, maximum: 90 }),
          ],
          responses: {
            '200': response('Paginated leak list', {
              type: 'object',
              properties: {
                leaks: arrayOf(ref('LeakInstance')),
                total: { type: 'integer' },
                page: { type: 'integer' },
                limit: { type: 'integer' },
              },
              required: ['leaks', 'total', 'page', 'limit'],
            }),
            ...errorResponses('500'),
          },
        },
      },
      '/api/leaks/{id}/context': {
        get: {
          tags: ['Leaks'],
          summary: 'Leak context bundle',
          description: 'Returns the selected leak plus related ledger commits, entity links, recent metrics, and proposed actions.',
          security: apiSecurity,
          parameters: [uuidPathParam('id', 'Leak instance identifier.')],
          responses: {
            '200': response('Leak context payload', jsonObjectSchema),
            ...errorResponses('404', '500'),
          },
        },
      },
      '/api/leaks/{id}/trace': {
        get: {
          tags: ['Leaks'],
          summary: 'Leak causal trace',
          description: 'Returns the recursive causal trace for a leak, including triggered commits, resulting actions, referenced evidence events, and downstream metric trend.',
          security: apiSecurity,
          parameters: [uuidPathParam('id', 'Leak instance identifier.')],
          responses: {
            '200': response('Leak trace payload', jsonObjectSchema),
            ...errorResponses('404', '500'),
          },
        },
      },
      '/api/feedback': {
        post: {
          tags: ['Leaks'],
          summary: 'Record feedback',
          description: 'Records approval rationale, rejection rationale, leak dismissal, or scope-correction feedback as events. Leak dismissals also update leak status; scope corrections reduce entity-link confidence.',
          security: apiSecurity,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    feedback_type: { type: 'string', enum: ['approval_rationale', 'rejection_rationale', 'leak_dismissal', 'scope_correction'] },
                    entity_id: { type: 'string' },
                    entity_type: { type: 'string', enum: ['leak', 'proposed_action', 'ledger_commit', 'event', 'entity_link'] },
                    actor_id: { type: 'string' },
                    reason: { type: 'string' },
                    team_id: idSchema,
                    metadata: jsonObjectSchema,
                  },
                  required: ['feedback_type', 'entity_id', 'entity_type'],
                },
                example: {
                  feedback_type: 'leak_dismissal',
                  entity_id: '1ac7de41-d11e-4a73-97d1-38dc6288cd68',
                  entity_type: 'leak',
                  actor_id: 'reviewer@example.com',
                  reason: 'Known maintenance window caused this signal.',
                },
              },
            },
          },
          responses: {
            '200': response('Feedback recorded', { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] }),
            ...errorResponses('400', '404', '500'),
          },
        },
      },
      '/api/approvals': {
        get: {
          tags: ['Approvals'],
          summary: 'List proposed actions awaiting approval',
          description: 'Returns paginated proposed actions, prioritizing pending items first. Supports status and team filters.',
          security: apiSecurity,
          parameters: [
            queryParam('page', 'Page number.', { type: 'integer', minimum: 1, default: 1 }),
            queryParam('limit', 'Page size.', { type: 'integer', minimum: 1, maximum: 50, default: 20 }),
            queryParam('status', 'Filter by approval status.', { type: 'string' }),
            queryParam('team_id', 'Optional team scope filter.', idSchema),
          ],
          responses: {
            '200': response('Paginated approvals list', {
              type: 'object',
              properties: {
                actions: arrayOf(ref('ProposedAction')),
                total: { type: 'integer' },
                page: { type: 'integer' },
                limit: { type: 'integer' },
              },
              required: ['actions', 'total', 'page', 'limit'],
            }),
            ...errorResponses('500'),
          },
        },
      },
      '/api/approvals/{id}/action': {
        post: {
          tags: ['Approvals'],
          summary: 'Approve or reject a proposed action',
          description: 'Transitions a pending proposed action to approved or rejected. The API records the actor and completion time.',
          security: apiSecurity,
          parameters: [uuidPathParam('id', 'Proposed action identifier.')],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    action: { type: 'string', enum: ['approve', 'reject'] },
                    actor: { type: 'string' },
                  },
                  required: ['action'],
                },
                example: {
                  action: 'approve',
                  actor: 'web_ui',
                },
              },
            },
          },
          responses: {
            '200': response('Updated proposed action', {
              type: 'object',
              properties: {
                action: ref('ProposedAction'),
              },
              required: ['action'],
            }),
            ...errorResponses('400', '404', '500'),
          },
        },
      },
      '/api/executions': {
        get: {
          tags: ['Approvals'],
          summary: 'Execution history',
          description: 'Returns executed action records joined with core proposed-action metadata. Useful for audit trails and rollback affordances.',
          security: apiSecurity,
          parameters: [
            queryParam('limit', 'Maximum number of executions to return.', { type: 'integer', minimum: 1, maximum: 50, default: 20 }),
          ],
          responses: {
            '200': response('Execution history payload', {
              type: 'object',
              properties: {
                executions: arrayOf(ref('ExecutedAction')),
                total: { type: 'integer' },
              },
              required: ['executions', 'total'],
            }),
            ...errorResponses('500'),
          },
        },
      },
      '/api/executions/{id}/rollback': {
        post: {
          tags: ['Approvals'],
          summary: 'Rollback an executed action',
          description: 'Attempts to rollback a previously executed action through the executor service.',
          security: apiSecurity,
          parameters: [uuidPathParam('id', 'Executed action identifier.')],
          requestBody: {
            required: false,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    actor: { type: 'string' },
                  },
                },
                example: {
                  actor: 'web_ui',
                },
              },
            },
          },
          responses: {
            '200': response('Rollback succeeded', {
              type: 'object',
              properties: {
                status: { type: 'string' },
              },
              required: ['status'],
            }),
            ...errorResponses('400', '500'),
          },
        },
      },
      '/api/ledger/tree': {
        get: {
          tags: ['Ledger'],
          summary: 'Ledger tree and graph payload',
          description: 'Returns the ledger tree payload used by the graph explorer: commits, leaks, teams, linked entities, inferred links, and available filter dimensions.',
          security: apiSecurity,
          parameters: [
            queryParam('commit_limit', 'Maximum commit nodes to include.', { type: 'integer', minimum: 50, maximum: 1200 }),
            queryParam('leak_limit', 'Maximum leak nodes to include.', { type: 'integer', minimum: 20, maximum: 600 }),
            queryParam('status', 'Filter by commit status.', { type: 'string' }),
            queryParam('commit_type', 'Filter by commit type.', { type: 'string' }),
            queryParam('team_id', 'Filter by team.', idSchema),
            queryParam('project_id', 'Filter by project.', idSchema),
            queryParam('from', 'Inclusive start date.', dateSchema),
            queryParam('to', 'Inclusive end date.', dateSchema),
            queryParam('branch', 'Filter by branch name.', { type: 'string' }),
            queryParam('jira_key', 'Filter by linked Jira issue key.', { type: 'string' }),
            queryParam('pr', 'Filter by linked GitHub PR identifier.', { type: 'string' }),
            queryParam('slack_channel', 'Filter by linked Slack channel identifier.', { type: 'string' }),
            queryParam('tags', 'Comma-separated tag list. Accepts tag or tags query key.', { type: 'string' }),
            queryParam('tag', 'Single or comma-separated tag filter alias.', { type: 'string' }),
          ],
          responses: {
            '200': response('Ledger graph payload', jsonObjectSchema),
            ...errorResponses('500'),
          },
        },
      },
      '/api/ledger': {
        get: {
          tags: ['Ledger'],
          summary: 'List ledger commits',
          description: 'Returns paginated ledger commits with optional status, commit_type, team, and project filters.',
          security: apiSecurity,
          parameters: [
            queryParam('page', 'Page number.', { type: 'integer', minimum: 1, default: 1 }),
            queryParam('limit', 'Page size.', { type: 'integer', minimum: 1, maximum: 50, default: 20 }),
            queryParam('status', 'Filter by commit status.', { type: 'string' }),
            queryParam('commit_type', 'Filter by commit type.', { type: 'string' }),
            queryParam('team_id', 'Filter by team.', idSchema),
            queryParam('project_id', 'Filter by project.', idSchema),
          ],
          responses: {
            '200': response('Paginated ledger commits', {
              type: 'object',
              properties: {
                commits: arrayOf(ref('LedgerCommit')),
                total: { type: 'integer' },
                page: { type: 'integer' },
                limit: { type: 'integer' },
              },
              required: ['commits', 'total', 'page', 'limit'],
            }),
            ...errorResponses('500'),
          },
        },
      },
      '/api/ledger/{id}': {
        get: {
          tags: ['Ledger'],
          summary: 'Get a ledger commit',
          description: 'Returns the full row for a single ledger commit.',
          security: apiSecurity,
          parameters: [uuidPathParam('id', 'Ledger commit identifier.')],
          responses: {
            '200': response('Ledger commit detail', {
              type: 'object',
              properties: {
                commit: ref('LedgerCommit'),
              },
              required: ['commit'],
            }),
            ...errorResponses('404', '500'),
          },
        },
      },
      '/api/ledger/{id}/promote': {
        post: {
          tags: ['Ledger'],
          summary: 'Promote a team or project commit to org policy',
          description: 'Creates a new org-scoped policy commit sourced from an existing approved or merged commit. The new commit remains in proposed status for review.',
          security: apiSecurity,
          parameters: [uuidPathParam('id', 'Source ledger commit identifier.')],
          requestBody: {
            required: false,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    rationale: { type: 'string' },
                  },
                },
                example: {
                  title: '[Org Policy] Require issue links for production changes',
                  rationale: 'Promoted from a repeated team-level decision.',
                },
              },
            },
          },
          responses: {
            '201': response('Promoted org-level commit', jsonObjectSchema),
            ...errorResponses('400', '404', '500'),
          },
        },
      },
      '/api/ledger/{id}/edges': {
        get: {
          tags: ['Ledger'],
          summary: 'Get commit edges',
          description: 'Returns resolved ledger edges for a commit, including embedded target data where available.',
          security: apiSecurity,
          parameters: [uuidPathParam('id', 'Ledger commit identifier.')],
          responses: {
            '200': response('Ledger edge list', jsonObjectSchema),
            ...errorResponses('500'),
          },
        },
      },
      '/api/ledger/{id}/graph': {
        get: {
          tags: ['Ledger'],
          summary: 'Traverse the ledger graph',
          description: 'Runs a breadth-first traversal from the selected commit and returns the connected graph payload used by the graph explorer.',
          security: apiSecurity,
          parameters: [
            uuidPathParam('id', 'Ledger commit identifier.'),
            queryParam('depth', 'Maximum BFS depth.', { type: 'integer', minimum: 1, maximum: 10, default: 5 }),
          ],
          responses: {
            '200': response('Connected graph payload', jsonObjectSchema),
            ...errorResponses('404', '500'),
          },
        },
      },
      '/api/ledger/routes': {
        get: {
          tags: ['Ledger Routes'],
          summary: 'List saved ledger routes',
          description: 'Returns active saved graph routes, optionally narrowed by team and project scope.',
          security: apiSecurity,
          parameters: [
            queryParam('team_id', 'Optional team scope filter.', idSchema),
            queryParam('project_id', 'Optional project scope filter.', idSchema),
            queryParam('limit', 'Maximum routes to return.', { type: 'integer', minimum: 1, maximum: 200, default: 80 }),
          ],
          responses: {
            '200': response('Saved routes', {
              type: 'object',
              properties: {
                routes: arrayOf(ref('LedgerRoute')),
              },
              required: ['routes'],
            }),
            ...errorResponses('500'),
          },
        },
        post: {
          tags: ['Ledger Routes'],
          summary: 'Create a saved ledger route',
          description: 'Stores a named graph snapshot plus dataset signature and optional solution draft for later review.',
          security: apiSecurity,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', maxLength: 255 },
                    snapshot: jsonObjectSchema,
                    dataset_signature: { type: 'string' },
                    solution_draft: { type: 'string' },
                    team_id: idSchema,
                    project_id: idSchema,
                    created_by: { type: 'string' },
                  },
                  required: ['name', 'snapshot', 'dataset_signature'],
                },
                example: {
                  name: 'Release readiness review',
                  dataset_signature: '8cdd4d80f4',
                  solution_draft: 'Route to platform and release engineering for approval.',
                  snapshot: {
                    datasetSignature: '8cdd4d80f4',
                    traversal: {
                      lockedFocusIds: ['node-1', 'node-2'],
                    },
                  },
                },
              },
            },
          },
          responses: {
            '201': response('Created route', {
              type: 'object',
              properties: {
                route: ref('LedgerRoute'),
              },
              required: ['route'],
            }),
            ...errorResponses('400', '404', '500'),
          },
        },
      },
      '/api/ledger/routes/{id}': {
        patch: {
          tags: ['Ledger Routes'],
          summary: 'Update a saved route',
          description: 'Updates the route name, solution draft, snapshot, focus nodes, or dataset signature.',
          security: apiSecurity,
          parameters: [uuidPathParam('id', 'Saved route identifier.')],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', maxLength: 255 },
                    solution_draft: { type: 'string', nullable: true },
                    dataset_signature: { type: 'string' },
                    snapshot: jsonObjectSchema,
                  },
                },
              },
            },
          },
          responses: {
            '200': response('Updated route', {
              type: 'object',
              properties: {
                route: ref('LedgerRoute'),
              },
              required: ['route'],
            }),
            ...errorResponses('400', '404', '500'),
          },
        },
        delete: {
          tags: ['Ledger Routes'],
          summary: 'Archive a saved route',
          description: 'Soft-deletes a route by setting its status to archived.',
          security: apiSecurity,
          parameters: [uuidPathParam('id', 'Saved route identifier.')],
          responses: {
            '200': response('Archived route result', jsonObjectSchema),
            ...errorResponses('404', '500'),
          },
        },
      },
      '/api/ledger/routes/{id}/dispatches': {
        get: {
          tags: ['Ledger Routes'],
          summary: 'List route dispatch attempts',
          description: 'Returns the audit trail of outbound review-packet dispatches for a saved route.',
          security: apiSecurity,
          parameters: [
            uuidPathParam('id', 'Saved route identifier.'),
            queryParam('limit', 'Maximum dispatches to return.', { type: 'integer', minimum: 1, maximum: 200, default: 50 }),
          ],
          responses: {
            '200': response('Dispatch history', {
              type: 'object',
              properties: {
                dispatches: arrayOf(ref('LedgerRouteDispatch')),
              },
              required: ['dispatches'],
            }),
            ...errorResponses('404', '500'),
          },
        },
      },
      '/api/ledger/routes/{id}/dispatch': {
        post: {
          tags: ['Ledger Routes'],
          summary: 'Dispatch a route review packet',
          description: 'Builds a review message for the saved route and sends it to Slack, Jira, or GitHub. Success and failure are both audited in ledger_route_dispatches.',
          security: apiSecurity,
          parameters: [uuidPathParam('id', 'Saved route identifier.')],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    provider: { type: 'string', enum: ['slack', 'jira', 'github'] },
                    target: { type: 'string' },
                    actor: { type: 'string' },
                    message: { type: 'string' },
                  },
                  required: ['provider', 'target'],
                },
                example: {
                  provider: 'github',
                  target: 'acme/platform#412',
                  actor: 'web_ui',
                },
              },
            },
          },
          responses: {
            '200': response('Dispatch result', jsonObjectSchema),
            ...errorResponses('400', '404', '502'),
          },
        },
      },
      '/api/metrics': {
        get: {
          tags: ['Metrics'],
          summary: 'List metric snapshots',
          description: 'Returns recent metric snapshots for the company and optional metric_name filter.',
          security: apiSecurity,
          parameters: [
            queryParam('days', 'Number of trailing days to return.', { type: 'integer', minimum: 1, maximum: 90, default: 14 }),
            queryParam('metric_name', 'Optional metric name filter.', { type: 'string' }),
          ],
          responses: {
            '200': response('Metric snapshot list', {
              type: 'object',
              properties: {
                metrics: arrayOf(ref('MetricSnapshot')),
              },
              required: ['metrics'],
            }),
            ...errorResponses('500'),
          },
        },
      },
      '/api/compare/metrics': {
        get: {
          tags: ['Metrics'],
          summary: 'Compare a metric across teams',
          description: 'Returns a time series per team plus an organization baseline for a required metric_name. If team_ids is omitted, the API compares all teams.',
          security: apiSecurity,
          parameters: [
            queryParam('metric_name', 'Metric name to compare.', { type: 'string' }, true),
            queryParam('team_ids', 'Comma-separated team identifiers. Defaults to all teams when omitted.', { type: 'string' }),
            queryParam('days', 'Trailing days to include.', { type: 'integer', minimum: 1, maximum: 90, default: 14 }),
          ],
          responses: {
            '200': response('Team comparison payload', jsonObjectSchema),
            ...errorResponses('400', '500'),
          },
        },
      },
      '/api/teams/health': {
        get: {
          tags: ['Metrics'],
          summary: 'Per-team health rollup',
          description: 'Computes a per-team health score from the latest metric snapshots, leak counts, and event volume.',
          security: apiSecurity,
          responses: {
            '200': response('Team health payload', jsonObjectSchema),
            ...errorResponses('500'),
          },
        },
      },
      '/api/events': {
        get: {
          tags: ['Entities'],
          summary: 'List normalized events',
          description: 'Returns the append-only event feed used by dashboard activity views.',
          security: apiSecurity,
          parameters: [
            queryParam('page', 'Page number.', { type: 'integer', minimum: 1, default: 1 }),
            queryParam('limit', 'Page size.', { type: 'integer', minimum: 1, maximum: 100, default: 20 }),
            queryParam('source', 'Filter by event source.', { type: 'string' }),
          ],
          responses: {
            '200': response('Paginated event list', {
              type: 'object',
              properties: {
                events: arrayOf(ref('Event')),
                total: { type: 'integer' },
                page: { type: 'integer' },
                limit: { type: 'integer' },
              },
              required: ['events', 'total', 'page', 'limit'],
            }),
            ...errorResponses('500'),
          },
        },
      },
      '/api/entity-links': {
        get: {
          tags: ['Entities'],
          summary: 'List explicit entity links',
          description: 'Returns cross-tool links between Slack, Jira, and GitHub entities with optional provider, entity_id, and link_type filters.',
          security: apiSecurity,
          parameters: [
            queryParam('entity_id', 'Filter to links that reference the provided entity id.', { type: 'string' }),
            queryParam('provider', 'Filter to links that reference the provided provider.', { type: 'string' }),
            queryParam('link_type', 'Filter by link type.', { type: 'string' }),
            queryParam('limit', 'Maximum number of links to return.', { type: 'integer', minimum: 1, maximum: 100, default: 50 }),
          ],
          responses: {
            '200': response('Entity link list', {
              type: 'object',
              properties: {
                links: arrayOf(ref('EntityLink')),
              },
              required: ['links'],
            }),
            ...errorResponses('500'),
          },
        },
      },
      '/api/entities/{provider}/{id}/connections': {
        get: {
          tags: ['Entities'],
          summary: 'Get all connections for an entity',
          description: 'Returns all outgoing and incoming connections for a concrete provider/entity pair together with raw link records.',
          security: apiSecurity,
          parameters: [
            stringPathParam('provider', 'Entity provider.', ['slack', 'jira', 'github']),
            stringPathParam('id', 'Entity identifier.'),
          ],
          responses: {
            '200': response('Entity connection payload', jsonObjectSchema),
            ...errorResponses('500'),
          },
        },
      },
      '/api/inference/run': {
        post: {
          tags: ['Inference'],
          summary: 'Run inferred-link generation',
          description: 'Runs the soft-link inference engine for the selected scope. Supports dry-run execution.',
          security: apiSecurity,
          requestBody: {
            required: false,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    team_id: idSchema,
                    project_id: idSchema,
                    dry_run: { type: 'boolean' },
                  },
                },
                example: {
                  team_id: 'd6f91587-94c2-481b-b904-93d4eec6d643',
                  dry_run: true,
                },
              },
            },
          },
          responses: {
            '200': response('Inference run result', jsonObjectSchema),
            ...errorResponses('404', '500'),
          },
        },
      },
      '/api/inferred-links/{id}': {
        patch: {
          tags: ['Inference'],
          summary: 'Confirm or dismiss an inferred link',
          description: 'Updates an inferred link to confirmed or dismissed and records the actor.',
          security: apiSecurity,
          parameters: [uuidPathParam('id', 'Inferred link identifier.')],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', enum: ['confirmed', 'dismissed'] },
                    actor: { type: 'string' },
                  },
                  required: ['status'],
                },
                example: {
                  status: 'confirmed',
                  actor: 'web_ui',
                },
              },
            },
          },
          responses: {
            '200': response('Updated inferred link', {
              type: 'object',
              properties: {
                inferred_link: ref('InferredLink'),
              },
              required: ['inferred_link'],
            }),
            ...errorResponses('400', '404', '500'),
          },
        },
      },
      '/api/teams': {
        get: {
          tags: ['Teams'],
          summary: 'List teams',
          description: 'Returns teams together with derived project, event, and active-leak counts.',
          security: apiSecurity,
          parameters: [
            queryParam('company_id', 'Optional company identifier override.', idSchema),
          ],
          responses: {
            '200': response('Team list', {
              type: 'object',
              properties: {
                teams: arrayOf(ref('Team')),
              },
              required: ['teams'],
            }),
            ...errorResponses('500'),
          },
        },
        post: {
          tags: ['Teams'],
          summary: 'Create a team',
          description: 'Creates a team record. When company_id is omitted, the primary company is used.',
          security: apiSecurity,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    company_id: idSchema,
                    name: { type: 'string' },
                    slug: { type: 'string' },
                    description: { type: 'string' },
                    lead_user_id: { type: 'string' },
                    color: { type: 'string' },
                    icon: { type: 'string' },
                  },
                  required: ['name', 'slug'],
                },
                example: {
                  name: 'Platform',
                  slug: 'platform',
                  color: '#2563EB',
                  icon: 'Shield',
                },
              },
            },
          },
          responses: {
            '201': response('Created team', {
              type: 'object',
              properties: {
                team: ref('Team'),
              },
              required: ['team'],
            }),
            ...errorResponses('400', '409', '500'),
          },
        },
      },
      '/api/teams/{id}': {
        get: {
          tags: ['Teams'],
          summary: 'Get a team and its projects',
          description: 'Returns the selected team plus its projects.',
          security: apiSecurity,
          parameters: [uuidPathParam('id', 'Team identifier.')],
          responses: {
            '200': response('Team detail payload', jsonObjectSchema),
            ...errorResponses('404', '500'),
          },
        },
        patch: {
          tags: ['Teams'],
          summary: 'Update a team',
          description: 'Dynamically updates team fields provided in the request body.',
          security: apiSecurity,
          parameters: [uuidPathParam('id', 'Team identifier.')],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    slug: { type: 'string' },
                    description: { type: 'string' },
                    lead_user_id: { type: 'string' },
                    color: { type: 'string' },
                    icon: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            '200': response('Updated team', {
              type: 'object',
              properties: {
                team: ref('Team'),
              },
              required: ['team'],
            }),
            ...errorResponses('400', '404', '409', '500'),
          },
        },
        delete: {
          tags: ['Teams'],
          summary: 'Delete a team',
          description: 'Deletes a team that belongs to the primary company.',
          security: apiSecurity,
          parameters: [uuidPathParam('id', 'Team identifier.')],
          responses: {
            '200': response('Deletion result', jsonObjectSchema),
            ...errorResponses('404', '500'),
          },
        },
      },
      '/api/teams/{id}/leak-rules': {
        get: {
          tags: ['Teams'],
          summary: 'List team custom leak rules',
          description: 'Returns the custom JQL-driven leak rules configured for the team.',
          security: apiSecurity,
          parameters: [uuidPathParam('id', 'Team identifier.')],
          responses: {
            '200': response('Team leak rules', jsonObjectSchema),
            ...errorResponses('500'),
          },
        },
        post: {
          tags: ['Teams'],
          summary: 'Create or update a team leak rule',
          description: 'Upserts a custom JQL-powered leak rule for the specified team.',
          security: apiSecurity,
          parameters: [uuidPathParam('id', 'Team identifier.')],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    description: { type: 'string' },
                    jql: { type: 'string', maxLength: 2000 },
                    threshold: { type: 'number' },
                    severity_multiplier: { type: 'number', minimum: 0.5, maximum: 2.0 },
                    enabled: { type: 'boolean' },
                  },
                  required: ['id', 'name', 'jql', 'threshold'],
                },
                example: {
                  id: 'rule-priority-bug-spike',
                  name: 'Priority bug spike',
                  jql: 'project = PLAT AND priority = Highest AND statusCategory != Done',
                  threshold: 5,
                  severity_multiplier: 1.2,
                },
              },
            },
          },
          responses: {
            '200': response('Updated team leak rules', jsonObjectSchema),
            ...errorResponses('400', '500'),
          },
        },
      },
      '/api/teams/{id}/leak-rules/{ruleId}': {
        delete: {
          tags: ['Teams'],
          summary: 'Delete a team leak rule',
          description: 'Removes a custom JQL leak rule after verifying the team belongs to the primary company.',
          security: apiSecurity,
          parameters: [
            uuidPathParam('id', 'Team identifier.'),
            stringPathParam('ruleId', 'Team leak-rule identifier.'),
          ],
          responses: {
            '200': response('Remaining team leak rules', jsonObjectSchema),
            ...errorResponses('404', '500'),
          },
        },
      },
      '/api/leak-rules/validate': {
        post: {
          tags: ['Teams'],
          summary: 'Validate a JQL leak rule',
          description: 'Performs a dry-run validation of the supplied JQL query.',
          security: apiSecurity,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    jql: { type: 'string', maxLength: 2000 },
                  },
                  required: ['jql'],
                },
                example: {
                  jql: 'project = PLAT AND priority = Highest',
                },
              },
            },
          },
          responses: {
            '200': response('Validation result', jsonObjectSchema),
            ...errorResponses('400', '500'),
          },
        },
      },
      '/api/leak-rules/evaluate': {
        post: {
          tags: ['Teams'],
          summary: 'Evaluate custom leak rules',
          description: 'Triggers evaluation of all custom JQL leak rules for the primary company.',
          security: apiSecurity,
          responses: {
            '200': response('Evaluation result', jsonObjectSchema),
            ...errorResponses('404', '500'),
          },
        },
      },
      '/api/projects': {
        get: {
          tags: ['Projects'],
          summary: 'List projects',
          description: 'Returns projects with optional company, team, and status filtering plus derived event and leak counts.',
          security: apiSecurity,
          parameters: [
            queryParam('company_id', 'Optional company identifier override.', idSchema),
            queryParam('team_id', 'Optional team filter.', idSchema),
            queryParam('status', 'Optional project status filter.', { type: 'string' }),
          ],
          responses: {
            '200': response('Project list', {
              type: 'object',
              properties: {
                projects: arrayOf(ref('Project')),
              },
              required: ['projects'],
            }),
            ...errorResponses('500'),
          },
        },
        post: {
          tags: ['Projects'],
          summary: 'Create a project',
          description: 'Creates a project and stores external mappings used during entity resolution.',
          security: apiSecurity,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    company_id: idSchema,
                    team_id: idSchema,
                    name: { type: 'string' },
                    slug: { type: 'string' },
                    description: { type: 'string' },
                    jira_project_keys: stringArraySchema,
                    github_repos: stringArraySchema,
                    slack_channel_ids: stringArraySchema,
                    status: { type: 'string', enum: ['active', 'completed', 'archived'] },
                    start_date: dateSchema,
                    target_date: dateSchema,
                  },
                  required: ['name', 'slug'],
                },
                example: {
                  team_id: '7df1cfb2-954d-45bb-b7f6-1d83ff316c5d',
                  name: 'Ledger Graph',
                  slug: 'ledger-graph',
                  jira_project_keys: ['LEDGER'],
                  github_repos: ['acme/flowguard'],
                  slack_channel_ids: ['C04ABC123'],
                },
              },
            },
          },
          responses: {
            '201': response('Created project', {
              type: 'object',
              properties: {
                project: ref('Project'),
              },
              required: ['project'],
            }),
            ...errorResponses('400', '409', '500'),
          },
        },
      },
      '/api/projects/{id}': {
        get: {
          tags: ['Projects'],
          summary: 'Get project detail',
          description: 'Returns a project record plus recent event and active-leak counts.',
          security: apiSecurity,
          parameters: [uuidPathParam('id', 'Project identifier.')],
          responses: {
            '200': response('Project detail payload', jsonObjectSchema),
            ...errorResponses('404', '500'),
          },
        },
        patch: {
          tags: ['Projects'],
          summary: 'Update a project',
          description: 'Dynamically updates project fields provided in the request body.',
          security: apiSecurity,
          parameters: [uuidPathParam('id', 'Project identifier.')],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    team_id: idSchema,
                    name: { type: 'string' },
                    slug: { type: 'string' },
                    description: { type: 'string' },
                    jira_project_keys: stringArraySchema,
                    github_repos: stringArraySchema,
                    slack_channel_ids: stringArraySchema,
                    status: { type: 'string', enum: ['active', 'completed', 'archived'] },
                    start_date: dateSchema,
                    target_date: dateSchema,
                  },
                },
              },
            },
          },
          responses: {
            '200': response('Updated project', {
              type: 'object',
              properties: {
                project: ref('Project'),
              },
              required: ['project'],
            }),
            ...errorResponses('400', '404', '409', '500'),
          },
        },
        delete: {
          tags: ['Projects'],
          summary: 'Delete a project',
          description: 'Deletes a project that belongs to the primary company.',
          security: apiSecurity,
          parameters: [uuidPathParam('id', 'Project identifier.')],
          responses: {
            '200': response('Deletion result', jsonObjectSchema),
            ...errorResponses('404', '500'),
          },
        },
      },
      '/api/projects/{id}/activity-graph': {
        get: {
          tags: ['Projects'],
          summary: 'Project activity graph',
          description: 'Returns project-scoped recent events, leaks, cross-tool edges, and health metrics for the project graph page.',
          security: apiSecurity,
          parameters: [
            uuidPathParam('id', 'Project identifier.'),
            queryParam('days', 'Trailing window in days.', { type: 'integer', minimum: 1, maximum: 90, default: 7 }),
          ],
          responses: {
            '200': response('Project activity graph payload', jsonObjectSchema),
            ...errorResponses('404', '500'),
          },
        },
      },
      '/api/sync/github-projects': {
        post: {
          tags: ['Projects'],
          summary: 'Sync GitHub Projects v2 metadata',
          description: 'Runs the GitHub Projects v2 synchronization flow for the primary company.',
          security: apiSecurity,
          responses: {
            '200': response('Sync result', jsonObjectSchema),
            ...errorResponses('404', '500'),
          },
        },
      },
      '/api/sync/jira-components': {
        post: {
          tags: ['Projects'],
          summary: 'Sync Jira components for a project key',
          description: 'Refreshes Jira component mappings used for sub-project resolution.',
          security: apiSecurity,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    project_key: { type: 'string' },
                  },
                  required: ['project_key'],
                },
                example: {
                  project_key: 'PLAT',
                },
              },
            },
          },
          responses: {
            '200': response('Sync result', jsonObjectSchema),
            ...errorResponses('400', '404', '500'),
          },
        },
      },
      '/api/settings': {
        get: {
          tags: ['Settings'],
          summary: 'Get company settings',
          description: 'Returns the primary company record together with integration summaries.',
          security: apiSecurity,
          responses: {
            '200': response('Settings payload', jsonObjectSchema),
            ...errorResponses('500'),
          },
        },
        patch: {
          tags: ['Settings'],
          summary: 'Patch company settings',
          description: 'Merges the supplied settings object into the primary company settings JSONB.',
          security: apiSecurity,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: jsonObjectSchema,
                example: {
                  confidence_threshold: 0.65,
                  digest_channel_ids: ['C04ABC123'],
                },
              },
            },
          },
          responses: {
            '200': response('Updated settings payload', jsonObjectSchema),
            ...errorResponses('404', '500'),
          },
        },
      },
      '/api/settings/ai-budget': {
        get: {
          tags: ['Settings'],
          summary: 'Get AI budget settings',
          description: 'Returns AI feature budgets, enabled features, and digest role mappings from company settings.',
          security: apiSecurity,
          responses: {
            '200': response('AI budget settings', jsonObjectSchema),
            ...errorResponses('404', '500'),
          },
        },
        patch: {
          tags: ['Settings'],
          summary: 'Patch AI budget settings',
          description: 'Updates ai_budget_per_day, ai_enabled_features, and digest_roles within the primary company settings.',
          security: apiSecurity,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ai_budget_per_day: { type: 'integer' },
                    ai_enabled_features: stringArraySchema,
                    digest_roles: jsonObjectSchema,
                  },
                },
                example: {
                  ai_budget_per_day: 25,
                  ai_enabled_features: ['recommendation_drafts', 'impact_summaries'],
                },
              },
            },
          },
          responses: {
            '200': response('Updated AI budget settings', jsonObjectSchema),
            ...errorResponses('404', '500'),
          },
        },
      },
      '/api/integrations': {
        get: {
          tags: ['Settings'],
          summary: 'List integrations',
          description: 'Returns integration summaries for the primary company.',
          security: apiSecurity,
          responses: {
            '200': response('Integration summaries', {
              type: 'object',
              properties: {
                integrations: arrayOf(ref('Integration')),
              },
              required: ['integrations'],
            }),
            ...errorResponses('500'),
          },
        },
      },
      '/admin/companies': {
        get: {
          tags: ['Admin'],
          summary: 'List companies',
          description: 'Returns all companies known to FlowGuard. Protected by x-admin-key when ADMIN_API_KEY is configured.',
          security: adminSecurity,
          responses: {
            '200': response('Company list', {
              type: 'object',
              properties: {
                companies: arrayOf(ref('Company')),
              },
              required: ['companies'],
            }),
          },
        },
      },
      '/admin/companies/{companyId}/settings': {
        patch: {
          tags: ['Admin'],
          summary: 'Patch a company settings subset',
          description: 'Updates the supported top-level operational settings for a specific company.',
          security: adminSecurity,
          parameters: [uuidPathParam('companyId', 'Company identifier.')],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    insight_budget_per_day: { type: 'integer', minimum: 1, maximum: 10 },
                    confidence_threshold: { type: 'number', minimum: 0, maximum: 1 },
                    digest_cron: { type: 'string' },
                    digest_user_ids: stringArraySchema,
                    digest_channel_ids: stringArraySchema,
                  },
                },
              },
            },
          },
          responses: {
            '200': response('Updated company settings', jsonObjectSchema),
            ...errorResponses('400', '404'),
          },
        },
      },
      '/admin/integrations/{companyId}': {
        get: {
          tags: ['Admin'],
          summary: 'List integrations for a company',
          description: 'Returns sanitized integration records for the requested company.',
          security: adminSecurity,
          parameters: [uuidPathParam('companyId', 'Company identifier.')],
          responses: {
            '200': response('Sanitized integrations', {
              type: 'object',
              properties: {
                integrations: arrayOf(ref('Integration')),
              },
              required: ['integrations'],
            }),
          },
        },
      },
      '/admin/integrations/{companyId}/{provider}': {
        put: {
          tags: ['Admin'],
          summary: 'Create or update an integration',
          description: 'Upserts integration status, installation metadata, token metadata, scopes, and webhook secret for a company/provider pair.',
          security: adminSecurity,
          parameters: [
            uuidPathParam('companyId', 'Company identifier.'),
            stringPathParam('provider', 'Integration provider.', ['slack', 'jira', 'github', 'zendesk']),
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', enum: ['pending', 'active', 'error', 'revoked'] },
                    installation_data: jsonObjectSchema,
                    token_data: jsonObjectSchema,
                    scopes: stringArraySchema,
                    webhook_secret: { type: 'string', nullable: true },
                  },
                },
                example: {
                  status: 'active',
                  installation_data: {
                    repo_full_name: 'acme/flowguard',
                  },
                  scopes: ['read:project'],
                },
              },
            },
          },
          responses: {
            '200': response('Upserted integration', jsonObjectSchema),
            ...errorResponses('400'),
          },
        },
      },
      '/webhooks/slack/events': {
        post: {
          tags: ['Webhooks'],
          summary: 'Slack Events API endpoint',
          description: 'Accepts Slack event callbacks, URL-verification challenges, and workflow step execute events. FlowGuard acknowledges immediately and processes supported event types asynchronously.',
          security: slackSecurity,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: jsonObjectSchema,
                example: {
                  type: 'event_callback',
                  team_id: 'T12345',
                  event: {
                    type: 'message',
                    channel: 'C12345',
                    text: 'We should backfill the ledger edges today.',
                    ts: '1741425931.004200',
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Challenge accepted or event acknowledged.',
              content: {
                'application/json': {
                  schema: jsonObjectSchema,
                },
              },
            },
            ...errorResponses('401'),
          },
        },
      },
      '/webhooks/slack/actions': {
        post: {
          tags: ['Webhooks'],
          summary: 'Slack interactive actions endpoint',
          description: 'Handles Slack button clicks, modal submissions, and workflow-builder configuration payloads.',
          security: slackSecurity,
          requestBody: {
            required: true,
            content: {
              'application/x-www-form-urlencoded': {
                schema: {
                  type: 'object',
                  properties: {
                    payload: { type: 'string' },
                  },
                  required: ['payload'],
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Action acknowledged.',
            },
            ...errorResponses('401'),
          },
        },
      },
      '/webhooks/slack/oauth/callback': {
        get: {
          tags: ['Webhooks'],
          summary: 'Slack OAuth callback',
          description: 'Exchanges an OAuth code for installation tokens and upserts the Slack integration for the resolved or default company.',
          parameters: [
            queryParam('code', 'OAuth authorization code.', { type: 'string' }),
            queryParam('state', 'Optional company or state payload.', { type: 'string' }),
            queryParam('error', 'OAuth error returned by Slack.', { type: 'string' }),
          ],
          responses: {
            '200': response('Integration connected', jsonObjectSchema),
            ...errorResponses('400', '500'),
          },
        },
      },
      '/webhooks/jira': {
        post: {
          tags: ['Webhooks'],
          summary: 'Jira webhook endpoint',
          description: 'Accepts Jira issue lifecycle and comment webhooks, normalizes them into FlowGuard events, and triggers component and entity-link enrichment.',
          security: jiraSecurity,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: jsonObjectSchema,
                example: {
                  webhookEvent: 'jira:issue_updated',
                  issue: {
                    id: '10025',
                    key: 'PLAT-42',
                    fields: {
                      project: { key: 'PLAT' },
                      status: { name: 'In Progress' },
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Webhook acknowledged.',
            },
            ...errorResponses('401'),
          },
        },
      },
      '/webhooks/github': {
        post: {
          tags: ['Webhooks'],
          summary: 'GitHub webhook endpoint',
          description: 'Accepts pull-request, review, deployment, check-suite, and GitHub Projects v2 item events. The API normalizes supported events and optionally emits PR commentary.',
          security: githubSecurity,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: jsonObjectSchema,
                example: {
                  action: 'opened',
                  repository: { full_name: 'acme/flowguard' },
                  pull_request: {
                    number: 412,
                    title: 'Document API routes',
                    state: 'open',
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Webhook acknowledged.',
            },
            ...errorResponses('401'),
          },
        },
      },
    },
  };
}