// Recipe pages for end-to-end tests of link import (R-06.2), served without a network when the
// fake AI provider runs on a local stack. Only hosts under the reserved `.test` top-level
// domain (RFC 6761) are served; every other link is fetched as usual. Nothing here runs
// against a hosted project, because select.ts only picks the fake on a local stack.

import type { FetchedPage } from '../fetch_page.ts';
import { FetchPageError } from '../fetch_page.ts';

/** A plain page with no embedded recipe data, so its text goes to the (fake) parser. */
const LEMON_CHICKEN = `<!doctype html><html><head><title>Lemon chicken traybake</title></head>
<body><header><nav><a href="/">Home</a></nav></header>
<main><h1>Lemon chicken traybake</h1><p>Serves 4</p><p>Prep: 10 mins | Cook: 40 mins</p>
<h2>Ingredients</h2><ul><li>4 chicken thighs</li><li>2 tbsp olive oil</li>
<li>1 lemon, sliced</li><li>500 g baby potatoes</li><li>1 tsp dried thyme</li></ul>
<h2>Method</h2><ol><li>Heat the oven to 200C.</li><li>Toss everything in a tin.</li>
<li>Roast for 40 minutes.</li></ol></main>
<footer><p>Written for Parent Manager tests.</p></footer></body></html>`;

export const FAKE_PAGES: Record<string, string> = {
  'https://recipes.example.test/lemon-chicken': LEMON_CHICKEN,
};

export function isFakePageHost(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase().endsWith('.test');
  } catch {
    return false;
  }
}

/** Wraps the real fetcher: `.test` links get a canned page or "unreachable", never the network. */
export function withFakePages(
  fetchPage: (url: string, signal: AbortSignal) => Promise<FetchedPage>,
): (url: string, signal: AbortSignal) => Promise<FetchedPage> {
  return (url, signal) => {
    if (!isFakePageHost(url)) return fetchPage(url, signal);
    const html = FAKE_PAGES[url];
    if (!html) return Promise.reject(new FetchPageError('import.link_unreachable'));
    return Promise.resolve({ url, html });
  };
}
