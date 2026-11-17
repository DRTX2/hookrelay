import { BlockList, isIP } from 'node:net';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { Agent } from 'undici';

// Customers choose the target URL, so without this anyone could make us call
// 169.254.169.254 (cloud metadata), localhost admin ports or the internal network.
const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3],
] as const) blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
] as const) blocked.addSubnet(net, prefix, 'ipv6');

export function isPrivateAddress(ip: string): boolean {
  const mapped = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped IPv6
  if (mapped) return blocked.check(mapped[1], 'ipv4');
  const family = isIP(ip);
  if (!family) return true;
  return blocked.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

export class UnsafeTargetError extends Error {}

/** Static checks done when an endpoint is registered. DNS is re-checked on every connection. */
export function assertSafeUrl(raw: string, allowPrivate: boolean): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeTargetError('Invalid URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new UnsafeTargetError('Only http(s) URLs are allowed');
  if (url.username || url.password) throw new UnsafeTargetError('Credentials in URL are not allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!allowPrivate && isIP(host) && isPrivateAddress(host)) throw new UnsafeTargetError('Private addresses are not allowed');
  return url;
}

/**
 * undici Agent whose DNS lookup rejects private addresses. Validating inside the
 * connect step (not before fetch) closes the DNS-rebinding gap between check and use.
 */
export function createSafeAgent(allowPrivate: boolean): Agent {
  return new Agent({
    connect: {
      lookup(hostname, options, cb) {
        dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
          if (err) return cb(err, []);
          const list = addresses as LookupAddress[];
          const bad = !allowPrivate && list.find((a) => isPrivateAddress(a.address));
          if (bad) return cb(new UnsafeTargetError(`Refusing to connect to private address ${bad.address}`), []);
          cb(null, list);
        });
      },
    },
    headersTimeout: 10_000,
    bodyTimeout: 10_000,
  });
}
