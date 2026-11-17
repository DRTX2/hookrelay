import { z } from 'zod';
import { CreateApp, CreateEndpoint, CreateMessage, ListMessagesQuery } from './contracts.js';

/** OpenAPI 3.1 built from the same zod schemas the controllers validate with. */
const body = (schema: z.ZodType) => ({
  required: true,
  content: { 'application/json': { schema: z.toJSONSchema(schema, { io: 'input' }) } },
});
const queryParams = (schema: z.ZodObject) => {
  const json = z.toJSONSchema(schema, { io: 'input' }) as { properties: Record<string, object>; required?: string[] };
  return Object.entries(json.properties).map(([name, s]) => ({ name, in: 'query', required: json.required?.includes(name) ?? false, schema: s }));
};
const uuidParam = (name: string) => ({ name, in: 'path', required: true, schema: { type: 'string', format: 'uuid' } });
const ok = (description: string) => ({ description });
const errors = { 400: ok('Validation error'), 401: ok('Missing or invalid API key'), 404: ok('Not found') };
const tenant = [{ apiKey: [] }];

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'Hookrelay API',
    version: '1.0.0',
    description:
      'Reliable webhook delivery: idempotent ingestion, fan-out, Standard Webhooks signatures, retries with backoff, circuit breaker and replay.',
  },
  components: {
    securitySchemes: {
      apiKey: { type: 'http', scheme: 'bearer', description: 'Tenant API key (`hr_...`)' },
      adminToken: { type: 'apiKey', in: 'header', name: 'x-admin-token' },
    },
  },
  paths: {
    '/v1/messages': {
      post: {
        summary: 'Send an event (fan-out to subscribed endpoints)',
        security: tenant,
        parameters: [{ name: 'Idempotency-Key', in: 'header', required: false, schema: { type: 'string', maxLength: 200 } }],
        requestBody: body(CreateMessage),
        responses: { 202: ok('Accepted, deliveries scheduled'), 200: ok('Duplicate Idempotency-Key: original message returned'), 429: ok('Rate limit exceeded'), ...errors },
      },
      get: { summary: 'List messages (cursor pagination)', security: tenant, parameters: queryParams(ListMessagesQuery), responses: { 200: ok('Page of messages'), ...errors } },
    },
    '/v1/messages/{id}': {
      get: { summary: 'Message with deliveries and attempt timeline', security: tenant, parameters: [uuidParam('id')], responses: { 200: ok('Message'), ...errors } },
    },
    '/v1/endpoints': {
      get: { summary: 'List endpoints with 24h health', security: tenant, responses: { 200: ok('Endpoints'), ...errors } },
      post: { summary: 'Register an endpoint (returns its signing secret)', security: tenant, requestBody: body(CreateEndpoint), responses: { 201: ok('Created'), ...errors } },
    },
    '/v1/endpoints/{id}': {
      get: { summary: 'Endpoint detail including secret', security: tenant, parameters: [uuidParam('id')], responses: { 200: ok('Endpoint'), ...errors } },
      delete: { summary: 'Delete endpoint', security: tenant, parameters: [uuidParam('id')], responses: { 204: ok('Deleted'), ...errors } },
    },
    '/v1/endpoints/{id}/enable': { post: { summary: 'Re-enable (close the circuit)', security: tenant, parameters: [uuidParam('id')], responses: { 204: ok('Enabled'), ...errors } } },
    '/v1/endpoints/{id}/disable': { post: { summary: 'Disable manually', security: tenant, parameters: [uuidParam('id')], responses: { 204: ok('Disabled'), ...errors } } },
    '/v1/deliveries/{id}/retry': {
      post: { summary: 'Resend a failed delivery (one attempt)', security: tenant, parameters: [uuidParam('id')], responses: { 202: ok('Scheduled'), 409: ok('Delivery is not failed'), ...errors } },
    },
    '/v1/stats': { get: { summary: 'Success rate, latency percentiles, hourly series (24h)', security: tenant, responses: { 200: ok('Stats'), ...errors } } },
    '/v1/stream': { get: { summary: 'Server-Sent Events: live delivery attempts', security: tenant, responses: { 200: ok('text/event-stream'), ...errors } } },
    '/v1/apps': { post: { summary: 'Create a tenant; returns its API key once', security: [{ adminToken: [] }], requestBody: body(CreateApp), responses: { 201: ok('Created'), 401: ok('Bad admin token') } } },
  },
};

/** Scalar API reference UI, loaded from a pinned CDN version. */
export const docsHtml = `<!doctype html>
<html><head><title>Hookrelay API</title><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body><script id="api-reference" data-url="/openapi.json"></script>
<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.25.0"></script></body></html>`;
