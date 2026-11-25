// A small client for the Storage API over fetch, with no dependencies (like _shared/admin.ts).
// Every call uses the service key: clients have no policy on the bucket, and the function
// checks who may read before it signs a link (V-02.3, R2-DOC-2, D-22).

export interface StoredFile {
  name: string;
  size: number;
}

export interface DocumentStorage {
  /** A one-time token the app uploads one file with (`uploadToSignedUrl`). */
  signUpload(path: string): Promise<string>;
  /** The files directly in a folder, as the service role. */
  list(folder: string): Promise<StoredFile[]>;
  /** The names of the folders directly in a folder (a household's document folders). */
  folders(folder: string): Promise<string[]>;
  /** A read link path (relative to /storage/v1), or null if the file isn't stored. */
  signRead(path: string, seconds: number): Promise<string | null>;
  remove(paths: string[]): Promise<void>;
}

export const BUCKET = 'documents';
const PAGE = 100;

export function documentStorage(
  url: string,
  serviceKey: string,
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

  type Entry = { name: string; id: string | null; metadata?: { size?: number } };

  /** Everything directly in a folder, a page at a time. */
  async function entries(folder: string): Promise<Entry[]> {
    const all: Entry[] = [];
    for (;;) {
      const res = await fetcher(`${base}/object/list/${BUCKET}`, {
        method: 'POST',
        headers: service,
        body: JSON.stringify({ prefix: folder, limit: PAGE, offset: all.length }),
      });
      const rows = await json<Entry[]>(res, 'list');
      all.push(...rows);
      if (rows.length < PAGE) return all;
    }
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
      // Rows without an id are subfolders.
      return (await entries(folder))
        .filter((row) => row.id !== null)
        .map((row) => ({ name: row.name, size: row.metadata?.size ?? 0 }));
    },
    async folders(folder) {
      return (await entries(folder)).filter((row) => row.id === null).map((row) => row.name);
    },
    async signRead(path, seconds) {
      const res = await fetcher(`${base}/object/sign/${BUCKET}/${encode(path)}`, {
        method: 'POST',
        headers: service,
        body: JSON.stringify({ expiresIn: seconds }),
      });
      // Storage answers 400 or 404 for a missing object.
      if (res.status === 400 || res.status === 404) {
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
