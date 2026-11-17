import Link from 'next/link';
import { notFound } from 'next/navigation';
import { api, ApiError, type MessageDetail } from '@/lib/api';
import { retryDelivery } from '../../actions';
import { ActionButton } from '../../client';

export default async function Message({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const msg = await api<MessageDetail>(`/v1/messages/${id}`).catch((e) => {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  });

  return (
    <>
      <Link href="/" className="muted">← Overview</Link>
      <h1 className="mono">{msg.eventType} <span className="muted small">{msg.id}</span></h1>
      <div className="grid-2">
        <section className="panel">
          <header className="panel-head"><h2>Payload</h2></header>
          <pre className="code">{JSON.stringify(msg.payload, null, 2)}</pre>
        </section>
        <section className="panel">
          <header className="panel-head"><h2>Meta</h2></header>
          <dl className="facts">
            <div><dt>Received</dt><dd>{new Date(msg.createdAt).toLocaleString()}</dd></div>
            <div><dt>Idempotency-Key</dt><dd className="mono">{msg.idempotencyKey ?? '—'}</dd></div>
            <div><dt>Fan-out</dt><dd>{msg.deliveries.length} endpoint(s)</dd></div>
          </dl>
        </section>
      </div>

      {msg.deliveries.map((d) => (
        <section key={d.id} className="panel">
          <header className="panel-head">
            <h2 className="mono url">{d.endpointUrl}</h2>
            <span className={`pill ${d.status}`}>{d.status}</span>
            {d.status === 'failed' && <ActionButton action={retryDelivery.bind(null, d.id)}>Resend</ActionButton>}
          </header>
          {d.status === 'pending' && d.nextAttemptAt && (
            <p className="muted">Next attempt {new Date(d.nextAttemptAt).toLocaleTimeString()}</p>
          )}
          <ol className="timeline">
            {d.attempts.map((a) => {
              const ok = a.statusCode !== null && a.statusCode >= 200 && a.statusCode < 300;
              return (
                <li key={a.attemptNo} className={ok ? 'ok' : 'err'}>
                  <div className="t-head">
                    <strong>#{a.attemptNo}</strong>
                    <span className={`pill ${ok ? 'succeeded' : 'failed'}`}>{a.statusCode ?? 'network error'}</span>
                    <span className="muted">{a.durationMs} ms · {new Date(a.createdAt).toLocaleTimeString()}</span>
                  </div>
                  {(a.error || a.responseBody) && <pre className="code small">{a.error ?? a.responseBody}</pre>}
                </li>
              );
            })}
            {d.attempts.length === 0 && <li className="muted">No attempts yet{d.lastError ? ` — ${d.lastError}` : ''}</li>}
          </ol>
        </section>
      ))}
    </>
  );
}
