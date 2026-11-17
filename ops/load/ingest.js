// k6 load test for the ingestion path (the SLO-critical one).
// usage: k6 run -e API=http://localhost:3000 -e KEY=hr_... ops/load/ingest.js
// Raise RATE_LIMIT_PER_MINUTE on the API first or you will measure the rate limiter.
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  scenarios: {
    steady: { executor: 'constant-arrival-rate', rate: Number(__ENV.RATE || 200), timeUnit: '1s', duration: __ENV.DURATION || '2m', preAllocatedVUs: 50, maxVUs: 300 },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{expected_response:true}': ['p(95)<300'], // ingestion SLO, see docs/OBSERVABILITY.md
  },
};

export default function () {
  const res = http.post(
    `${__ENV.API}/v1/messages`,
    JSON.stringify({ eventType: 'load.test', payload: { n: __ITER, vu: __VU } }),
    { headers: { 'content-type': 'application/json', authorization: `Bearer ${__ENV.KEY}`, 'idempotency-key': `${__VU}-${__ITER}` } },
  );
  check(res, { accepted: (r) => r.status === 202 || r.status === 200 });
}
