import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { fetch } from 'undici';
import type { SendResult, WebhookSender } from '../application/ports.js';
import { createSafeAgent } from './ssrf.js';

const TIMEOUT_MS = 15_000;
const MAX_STORED_BODY = 2048;

@Injectable()
export class HttpWebhookSender implements WebhookSender, OnModuleDestroy {
  private readonly agent = createSafeAgent(process.env.ALLOW_PRIVATE_TARGETS === 'true');

  async send(url: string, body: string, headers: Record<string, string>): Promise<SendResult> {
    const started = performance.now();
    try {
      const res = await fetch(url, {
        method: 'POST',
        body,
        headers,
        redirect: 'manual', // following redirects would bypass the SSRF check on the original URL
        dispatcher: this.agent,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const responseBody = (await res.text()).slice(0, MAX_STORED_BODY);
      return { statusCode: res.status, responseBody, error: null, durationMs: Math.round(performance.now() - started) };
    } catch (e) {
      const err = e as Error & { cause?: Error };
      const error = (err.cause?.message ?? err.message).slice(0, 500);
      return { statusCode: null, responseBody: null, error, durationMs: Math.round(performance.now() - started) };
    }
  }

  async onModuleDestroy() {
    await this.agent.close();
  }
}
