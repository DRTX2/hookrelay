import Link from 'next/link';
import { api, type MessageRow, type Stats } from '@/lib/api';
import { sendTestEvent } from './actions';
import { ActionForm, LiveFeed } from './client';

const pct = (n: number | null) => (n === null ? '—' : `${(n * 100).toFixed(1)}%`);
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function Chart({ series }: { series: Stats['series'] }) {
  const max = Math.max(1, ...series.map((s) => s.ok + s.err));
  const w = 100 / series.length;
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="chart" role="img" aria-label="Attempts per hour, last 24 hours">
      {series.map((s, i) => {
        const okH = (s.ok / max) * 38;
        const errH = (s.err / max) * 38;
        return (
          <g key={s.hour}>
            <title>{`${new Date(s.hour).getHours()}:00 — ${s.ok} ok, ${s.err} failed`}</title>
            <rect x={i * w + 0.4} y={40 - okH} width={w - 0.8} height={okH} className="bar-ok" />
            <rect x={i * w + 0.4} y={40 - okH - errH} width={w - 0.8} height={errH} className="bar-err" />
          </g>
        );
      })}
    </svg>
  );
}

export default async function Overview() {
  const [stats, messages] = await Promise.all([
    api<Stats>('/v1/stats'),
    api<{ data: MessageRow[] }>('/v1/messages?limit=15'),
  ]);

  return (
    <>
      <h1>Overview <span className="muted small">last 24h</span></h1>
      <div className="kpis">
        <div className="kpi"><span>Success rate</span><strong>{pct(stats.successRate)}</strong></div>
        <div className="kpi"><span>Delivered</span><strong>{stats.succeeded}</strong></div>
        <div className="kpi"><span>Failed</span><strong className={stats.failed ? 'bad' : ''}>{stats.failed}</strong></div>
        <div className="kpi"><span>In retry</span><strong>{stats.pending}</strong></div>
        <div className="kpi"><span>Latency p50 / p95</span><strong>{stats.p50 ?? '—'} / {stats.p95 ?? '—'} <small>ms</small></strong></div>
      </div>

      <section className="panel">
        <header className="panel-head"><h2>Attempts per hour</h2><span className="legend"><i className="ok" /> 2xx <i className="err" /> error</span></header>
        <Chart series={stats.series} />
      </section>

      <div className="grid-2">
        <LiveFeed />
        <section className="panel">
          <header className="panel-head"><h2>Send a test event</h2></header>
          <ActionForm action={sendTestEvent} submit="Send event" className="stack">
            <label>Event type<input name="eventType" defaultValue="order.created" required pattern="[\w.\-]{1,100}" /></label>
            <label>Payload (JSON)<textarea name="payload" rows={4} defaultValue={'{\n  "orderId": 1042,\n  "total": 99.9\n}'} className="mono" /></label>
            <label>Idempotency-Key <span className="muted">(optional, send twice to see dedupe)</span><input name="idempotencyKey" /></label>
          </ActionForm>
        </section>
      </div>

      <section className="panel">
        <header className="panel-head"><h2>Recent messages</h2></header>
        {messages.data.length === 0 ? <p className="empty">No messages yet.</p> : (
          <table>
            <thead><tr><th>Message</th><th>Event</th><th>Fan-out</th><th>Status</th><th>Received</th></tr></thead>
            <tbody>
              {messages.data.map((m) => (
                <tr key={m.id}>
                  <td><Link href={`/messages/${m.id}`} className="mono">{m.id.slice(0, 8)}</Link></td>
                  <td className="mono">{m.eventType}</td>
                  <td>{m.fanout}</td>
                  <td className="pills">
                    {m.succeeded > 0 && <span className="pill succeeded">{m.succeeded} ok</span>}
                    {m.pending > 0 && <span className="pill pending">{m.pending} retrying</span>}
                    {m.failed > 0 && <span className="pill failed">{m.failed} failed</span>}
                    {m.fanout === 0 && <span className="muted">no subscribers</span>}
                  </td>
                  <td className="muted">{time(m.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
