import Link from 'next/link';
import { api, type DeadLetter } from '@/lib/api';
import { replayDeadLetters, retryDelivery } from '../actions';
import { ActionButton } from '../client';

export default async function DeadLetters() {
  const dlq = await api<{ data: DeadLetter[]; total: number }>('/v1/dead-letters?limit=100');
  const byEndpoint = Object.values(
    dlq.data.reduce<Record<string, { id: string; url: string; n: number }>>((acc, d) => {
      acc[d.endpointId] ??= { id: d.endpointId, url: d.endpointUrl, n: 0 };
      acc[d.endpointId].n++;
      return acc;
    }, {}),
  );

  return (
    <>
      <h1>Dead letters <span className="muted small">{dlq.total} deliveries exhausted their retries</span></h1>
      {dlq.total === 0 ? (
        <p className="empty panel">Nothing here. Every delivery either succeeded or is still retrying.</p>
      ) : (
        <>
          <section className="panel">
            <header className="panel-head">
              <h2>Replay</h2>
              <span className="muted small">One attempt per delivery. Failures return here. Disabled endpoints are skipped</span>
            </header>
            <div className="actions">
              <ActionButton action={replayDeadLetters.bind(null, undefined)} variant="primary">Replay all ({dlq.total})</ActionButton>
              {byEndpoint.map((e) => (
                <ActionButton key={e.id} action={replayDeadLetters.bind(null, e.id)}>
                  {e.url.replace(/^https?:\/\//, '')} ({e.n})
                </ActionButton>
              ))}
            </div>
          </section>
          <section className="panel">
            <table>
              <thead><tr><th>Message</th><th>Event</th><th>Endpoint</th><th>Attempts</th><th>Last error</th><th>Failed</th><th /></tr></thead>
              <tbody>
                {dlq.data.map((d) => (
                  <tr key={d.id}>
                    <td><Link href={`/messages/${d.messageId}`} className="mono">{d.messageId.slice(0, 8)}</Link></td>
                    <td className="mono">{d.eventType}</td>
                    <td className="mono url">{d.endpointUrl}</td>
                    <td>{d.attemptCount}</td>
                    <td className="muted">{d.lastError ?? '—'}</td>
                    <td className="muted">{new Date(d.failedAt).toLocaleString()}</td>
                    <td><ActionButton action={retryDelivery.bind(null, d.id)}>Resend</ActionButton></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </>
  );
}
