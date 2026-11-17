'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import type { FormState } from './actions';

export function ActionForm({
  action, children, submit, className,
}: {
  action: (s: FormState, f: FormData) => Promise<FormState>;
  children: React.ReactNode;
  submit: string;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className={className}>
      {children}
      <div className="form-foot">
        <button className="btn primary" disabled={pending}>{pending ? 'Working…' : submit}</button>
        {state?.error && <span className="msg err" role="alert">{state.error}</span>}
        {state?.ok && <span className="msg ok" role="status">{state.ok}</span>}
      </div>
    </form>
  );
}

/** Button that calls a bound server action, with pending state. */
export function ActionButton({ action, children, variant = '' }: { action: () => Promise<void>; children: React.ReactNode; variant?: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <>
      <button
        className={`btn small ${variant}`}
        disabled={pending}
        onClick={() => start(async () => { try { setError(undefined); await action(); } catch { setError('Failed'); } })}
      >
        {pending ? '…' : children}
      </button>
      {error && <span className="msg err">{error}</span>}
    </>
  );
}

interface LiveEvent {
  deliveryId: string; messageId: string; status: 'pending' | 'succeeded' | 'failed';
  attemptNo: number; statusCode: number | null; durationMs: number; at: string;
}

export function LiveFeed() {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const es = new EventSource('/api/stream');
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false); // EventSource reconnects by itself
    es.addEventListener('delivery', (e) => {
      setEvents((prev) => [JSON.parse((e as MessageEvent).data), ...prev].slice(0, 30));
    });
    return () => es.close();
  }, []);

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Live deliveries</h2>
        <span className={`conn ${connected ? 'on' : ''}`}>{connected ? 'streaming' : 'connecting'}</span>
      </header>
      {events.length === 0 ? (
        <p className="empty">Waiting for delivery attempts… send a test event.</p>
      ) : (
        <ul className="feed">
          {events.map((e) => (
            <li key={`${e.deliveryId}-${e.attemptNo}`} className="feed-row">
              <span className={`pill ${e.status}`}>{e.statusCode ?? 'ERR'}</span>
              <Link href={`/messages/${e.messageId}`} className="mono">{e.deliveryId.slice(0, 8)}</Link>
              <span className="muted">attempt #{e.attemptNo}</span>
              <span className="muted right">{e.durationMs} ms</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
