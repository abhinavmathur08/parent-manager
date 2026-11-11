// Fetches a recipe page for a link import, treating the web as untrusted (architecture
// section 6): http and https only, standard ports, public IP addresses only (checked on every
// redirect hop), a size cap, a timeout, and HTML only.

import { isPublicAddress, parseIPv4, parseIPv6 } from './ip.ts';

export const MAX_URL_CHARS = 2048;
export const MAX_PAGE_BYTES = 2 * 1024 * 1024;
export const FETCH_TIMEOUT_MS = 10_000;
export const MAX_REDIRECTS = 3;

/** A refused or failed fetch; `code` is the stable error code the app translates. */
export class FetchPageError extends Error {
  constructor(readonly code: FetchPageErrorCode) {
    super(code);
    this.name = 'FetchPageError';
  }
}

export type FetchPageErrorCode =
  /** Not http(s), a non-standard port, credentials, or a private or unresolvable address. */
  | 'import.link_refused'
  /** The site didn't answer, answered with an error, or redirected too often. */
  | 'import.link_unreachable'
  /** Not an HTML page. */
  | 'import.link_unsupported'
  | 'import.link_too_large';

export interface FetchPageDeps {
  fetch: typeof fetch;
  /** Returns every A and AAAA address for a host name. */
  resolve(hostname: string): Promise<string[]>;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface FetchedPage {
  /** The URL the page was finally read from, after redirects. */
  url: string;
  html: string;
}

/**
 * Checks a URL's shape before anything is fetched: http or https, default port, no
 * credentials, a dotted host name or an IP literal. Returns the parsed URL, or null.
 */
export function checkLinkShape(raw: string): URL | null {
  if (raw.length > MAX_URL_CHARS) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.port !== '') return null;
  if (url.username !== '' || url.password !== '') return null;
  const host = url.hostname.toLowerCase();
  if (isIpLiteral(host)) return isPublicAddress(host) ? url : null;
  if (!host.includes('.') || /\.(localhost|local|internal|home\.arpa)\.?$/.test(host)) return null;
  return url;
}

function isIpLiteral(host: string): boolean {
  return parseIPv4(host) !== null || (host.startsWith('[') && parseIPv6(host) !== null);
}

async function assertPublicHost(url: URL, deps: FetchPageDeps): Promise<void> {
  const host = url.hostname.toLowerCase();
  if (isIpLiteral(host)) {
    if (!isPublicAddress(host)) throw new FetchPageError('import.link_refused');
    return;
  }
  let addresses: string[];
  try {
    addresses = await deps.resolve(host);
  } catch {
    throw new FetchPageError('import.link_refused');
  }
  // Every address must be public, so a host can't mix a public and a private record.
  if (addresses.length === 0 || !addresses.every(isPublicAddress)) {
    throw new FetchPageError('import.link_refused');
  }
}

/**
 * Fetches an HTML page with the guards above. Redirects are followed by hand, at most
 * MAX_REDIRECTS times, and each hop is checked like the first.
 *
 * Remaining risk: the runtime's fetch resolves the host again, so a DNS answer that changes
 * between the check and the fetch (DNS rebinding) isn't caught. Edge Functions run outside
 * our database's network, which limits what such a request could reach.
 */
export async function fetchPage(
  raw: string,
  deps: FetchPageDeps,
  outerSignal?: AbortSignal,
): Promise<FetchedPage> {
  const timeout = AbortSignal.timeout(deps.timeoutMs ?? FETCH_TIMEOUT_MS);
  const signal = outerSignal ? AbortSignal.any([outerSignal, timeout]) : timeout;
  const maxBytes = deps.maxBytes ?? MAX_PAGE_BYTES;

  let url = checkLinkShape(raw);
  if (!url) throw new FetchPageError('import.link_refused');

  for (let hop = 0; ; hop++) {
    await assertPublicHost(url, deps);

    let response: Response;
    try {
      response = await deps.fetch(url, {
        redirect: 'manual',
        signal,
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'User-Agent': 'ParentManagerImport/1',
        },
      });
    } catch {
      throw new FetchPageError('import.link_unreachable');
    }

    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      const location = response.headers.get('Location');
      if (!location || hop >= MAX_REDIRECTS) throw new FetchPageError('import.link_unreachable');
      let next: URL | null;
      try {
        next = checkLinkShape(new URL(location, url).href);
      } catch {
        next = null;
      }
      if (!next) throw new FetchPageError('import.link_refused');
      url = next;
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel();
      throw new FetchPageError('import.link_unreachable');
    }

    const type = (response.headers.get('Content-Type') ?? '').toLowerCase();
    if (!/^(text\/html|application\/xhtml\+xml)\b/.test(type)) {
      await response.body?.cancel();
      throw new FetchPageError('import.link_unsupported');
    }
    const declared = Number(response.headers.get('Content-Length') ?? '0');
    if (declared > maxBytes) {
      await response.body?.cancel();
      throw new FetchPageError('import.link_too_large');
    }

    const bytes = await readCapped(response, maxBytes);
    return { url: url.href, html: decode(bytes, type) };
  }
}

async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new FetchPageError('import.link_too_large');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof FetchPageError) throw error;
    throw new FetchPageError('import.link_unreachable');
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function decode(bytes: Uint8Array, contentType: string): string {
  const charset = /charset=([\w-]+)/.exec(contentType)?.[1];
  try {
    return new TextDecoder(charset ?? 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** A resolver using the runtime's DNS. */
export async function resolveWithDns(hostname: string): Promise<string[]> {
  const lookups = await Promise.allSettled([
    Deno.resolveDns(hostname, 'A'),
    Deno.resolveDns(hostname, 'AAAA'),
  ]);
  return lookups.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
}
