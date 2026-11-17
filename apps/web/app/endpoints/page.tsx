import { api, type Endpoint } from '@/lib/api';
import { createEndpoint, deleteEndpoint, setEndpointEnabled } from '../actions';
import { ActionButton, ActionForm } from '../client';

export default async function Endpoints() {
  const list = await api<Endpoint[]>('/v1/endpoints');
  // Secrets come from the detail route only; fetch them server-side for the reveal boxes.
  const secrets = await Promise.all(list.map((e) => api<Endpoint>(`/v1/endpoints/${e.id}`).then((d) => d.secret)));

  return (
    <>
      <h1>Endpoints</h1>
      <section className="panel">
        <header className="panel-head"><h2>Add endpoint</h2></header>
        <ActionForm action={createEndpoint} submit="Create endpoint" className="row-form">
          <label className="grow">URL<input name="url" type="url" placeholder="https://example.com/webhooks" required /></label>
          <label>Event types <span className="muted">(comma-separated, empty = all)</span><input name="eventTypes" placeholder="order.created, order.paid" /></label>
          <label>Description<input name="description" maxLength={200} /></label>
        </ActionForm>
      </section>

      {list.length === 0 ? <p className="empty">No endpoints yet.</p> : (
        <div className="cards">
          {list.map((e, i) => {
            const total = e.succeeded24h + e.failed24h;
            return (
              <article key={e.id} className={`panel endpoint ${e.disabledAt ? 'disabled' : ''}`}>
                <header className="panel-head">
                  <h2 className="mono url">{e.url}</h2>
                  <span className={`pill ${e.disabledAt ? 'failed' : 'succeeded'}`}>{e.disabledAt ? 'disabled' : 'active'}</span>
                </header>
                {e.description && <p className="muted">{e.description}</p>}
                {e.disabledReason && <p className="msg err">{e.disabledReason}</p>}
                <dl className="facts">
                  <div><dt>Events</dt><dd className="mono">{e.eventTypes?.join(', ') ?? 'all'}</dd></div>
                  <div><dt>Success 24h</dt><dd>{total ? `${Math.round((e.succeeded24h / total) * 100)}% of ${total}` : '—'}</dd></div>
                  <div><dt>Retrying</dt><dd>{e.pending}</dd></div>
                  <div><dt>Failure streak</dt><dd>{e.failureStreak}</dd></div>
                </dl>
                <details>
                  <summary>Signing secret</summary>
                  <code className="secret">{secrets[i]}</code>
                </details>
                <div className="actions">
                  <ActionButton action={setEndpointEnabled.bind(null, e.id, !!e.disabledAt)}>{e.disabledAt ? 'Enable' : 'Disable'}</ActionButton>
                  <ActionButton action={deleteEndpoint.bind(null, e.id)} variant="danger">Delete</ActionButton>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
