import { z } from 'zod';

/**
 * Request contracts. Single source of truth: controllers validate with these schemas and
 * openapi.ts turns the same schemas into the published OpenAPI document (no drift).
 */
export const EventType = z.string().regex(/^[\w.-]{1,100}$/).describe('e.g. order.created');

export const CreateMessage = z.object({
  eventType: EventType,
  payload: z.record(z.string(), z.unknown()).describe('Any JSON object, delivered as `data`'),
});
export const IdempotencyKey = z.string().min(1).max(200).optional();
export const ListMessagesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.iso.datetime({ offset: true }).optional().describe('Cursor: createdAt of the last item of the previous page'),
  eventType: z.string().max(100).optional(),
});

export const CreateEndpoint = z.object({
  url: z.string().max(2048).describe('https URL; private/loopback/metadata addresses are rejected'),
  description: z.string().max(200).optional(),
  eventTypes: z.array(EventType).max(50).optional().describe('Empty or omitted = all event types'),
});

export const CreateApp = z.object({ name: z.string().min(1).max(100) });

export type CreateMessage = z.infer<typeof CreateMessage>;
export type ListMessagesQuery = z.infer<typeof ListMessagesQuery>;
export type CreateEndpoint = z.infer<typeof CreateEndpoint>;
