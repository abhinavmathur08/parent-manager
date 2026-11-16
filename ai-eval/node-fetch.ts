type IncomingMessage = {
  statusCode?: number;
  setEncoding(encoding: 'utf8'): void;
  on(event: 'data', listener: (chunk: string) => void): void;
  on(event: 'end', listener: () => void): void;
};
type ClientRequest = {
  on(event: 'error', listener: (error: Error) => void): void;
  destroy(error: Error): void;
  write(body: string): void;
  end(): void;
};
// The app's TypeScript config has no Node types, so load https untyped.
const { request } = jest.requireActual<{
  request(
    url: string,
    options: { method: string; headers?: Record<string, string> },
    callback: (res: IncomingMessage) => void,
  ): ClientRequest;
}>('https');

/**
 * A minimal fetch over Node's https module. The jest-expo preset replaces the global fetch
 * with a stub, so the live evaluation passes this to the provider adapter instead.
 */
export const nodeFetch = ((url: string, init: RequestInit = {}) =>
  new Promise<Response>((resolve, reject) => {
    const req = request(
      url,
      { method: init.method ?? 'GET', headers: init.headers as Record<string, string> },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (text += chunk));
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          resolve({
            status,
            ok: status >= 200 && status < 300,
            json: () => Promise.resolve(JSON.parse(text)),
            text: () => Promise.resolve(text),
          } as Response);
        });
      },
    );
    req.on('error', reject);
    init.signal?.addEventListener('abort', () => req.destroy(new Error('aborted')));
    if (typeof init.body === 'string') req.write(init.body);
    req.end();
  })) as typeof fetch;
