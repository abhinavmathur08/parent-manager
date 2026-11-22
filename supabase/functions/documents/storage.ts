// A small client for the Storage API over fetch, with no dependencies (like _shared/admin.ts).
// Service calls use the service key; reads are signed as the caller, so the bucket's select
// policy decides who may read (V-02.2, R2-DOC-2).

export interface StoredFile {
  name: string;
  size: number;
}

export interface DocumentStorage {
  /** A one-time token the app uploads one file with (`uploadToSignedUrl`). */
  signUpload(path: string): Promise<string>;
  /** The files directly in a folder, as the service role. */
  list(folder: string): Promise<StoredFile[]>;
  /** A read link path (relative to /storage/v1) signed as the caller, or null if refused. */
  signRead(path: string, seconds: number, accessToken: string): Promise<string | null>;
  remove(paths: string[]): Promise<void>;
}

export const BUCKET = 'documents';

export function documentStorage(
  url: string,
  serviceKey: string,
  publishableKey: string,
  fetcher: typeof fetch = fetch,
): DocumentStorage {
  const service: Record<string, string> = {
    apikey: serviceKey,
    'Content-Type': 'application/json',
  };
  if (serviceKey.startsWith('eyJ')) service.Authorization = `Bearer ${serviceKey}`;
  const base = `${url}/storage/v1`;
  const encode = (path: string) => path.split('/').map(encodeURIComponent).join('/');

  async function json<T>(res: Response, what: string): Promise<T> {
    if (!res.ok) {
      await res.body?.cancel();
      // The status only: paths hold IDs, but nothing about the request is logged.
      throw new Error(`storage ${what} failed with ${res.status}`);
    }
    return (await res.json()) as T;
  }

  return {
    async signUpload(path) {
      const res = await fetcher(`${base}/object/upload/sign/${BUCKET}/${encode(path)}`, {
        method: 'POST',
        headers: service,
      });
      const { url: signed } = await json<{ url: string }>(res, 'upload sign');
      const token = new URL(signed, 'http://storage').searchParams.get('token');
      if (!token) throw new Error('storage upload sign returned no token');
      return token;
    },
    async list(folder) {
      const res = await fetcher(`${base}/object/list/${BUCKET}`, {
        method: 'POST',
        headers: service,
        body: JSON.stringify({ prefix: folder, limit: 100, offset: 0 }),
      });
      const rows = await json<{ name: string; id: string | null; metadata?: { size?: number } }[]>(
        res,
        'list',
      );
      // Rows without an id are subfolders.
      return rows
        .filter((row) => row.id !== null)
        .map((row) => ({ name: row.name, size: row.metadata?.size ?? 0 }));
    },
    async signRead(path, seconds, accessToken) {
      const res = await fetcher(`${base}/object/sign/${BUCKET}/${encode(path)}`, {
        method: 'POST',
        headers: {
          apikey: publishableKey,
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expiresIn: seconds }),
      });
      // Storage answers 400 or 404 when the select policy hides the object.
      if (res.status === 400 || res.status === 403 || res.status === 404) {
        await res.body?.cancel();
        return null;
      }
      const { signedURL } = await json<{ signedURL: string }>(res, 'read sign');
      return signedURL;
    },
    async remove(paths) {
      if (paths.length === 0) return;
      const res = await fetcher(`${base}/object/${BUCKET}`, {
        method: 'DELETE',
        headers: service,
        body: JSON.stringify({ prefixes: paths }),
      });
      await json<unknown>(res, 'remove');
    },
  };
}
