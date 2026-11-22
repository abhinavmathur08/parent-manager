import { assert, assertEquals } from 'jsr:@std/assert@1';

import {
  createHandler,
  type Limits,
  type NewDocument,
  type StoredDocument,
  type UploadContext,
} from './handler.ts';
import type { DocumentStorage } from './storage.ts';

const H = '00000000-0000-0000-0000-00000000000a';
const PARENT = 'aaaaaaaa-0000-0000-0000-000000000001';
const CAREGIVER = 'aaaaaaaa-0000-0000-0000-000000000003';
/** A parent of another household. */
const OTHER_PARENT = 'bbbbbbbb-0000-0000-0000-000000000001';
const SECRET = 'cron-secret';
const MB = 1024 * 1024;
const LIMITS: Limits = {
  free_documents: 25,
  premium_bytes: 2 * 1024 * MB,
  file_bytes: 10 * MB,
  pages: 20,
  read_seconds: 60,
};

let next = 0;
const newId = () => `dddddddd-0000-0000-0000-${String(++next).padStart(12, '0')}`;

/** An in-memory household, bucket and purge queue, shaped like the database and Storage. */
function world(opts: { documents?: number; bytes?: number; premium?: boolean } = {}) {
  const rows = new Map<string, NewDocument & { deleted_at: string | null }>();
  const files = new Map<string, number>();
  const queue: { id: number; prefix: string }[] = [];
  const signed: { path: string; seconds: number }[] = [];
  const checks: { caller: string; id: string }[] = [];
  const logs: string[] = [];
  /** Who `private.can_read_document` lets read, per document. */
  const readers = new Map<string, Set<string>>();
  const roles: Record<string, UploadContext['role']> = {
    [PARENT]: 'parent',
    [CAREGIVER]: 'caregiver',
    [OTHER_PARENT]: 'parent',
  };

  const storage: DocumentStorage = {
    signUpload: (path) => Promise.resolve(`upload:${path}`),
    list: (folder) =>
      Promise.resolve(
        [...files]
          .filter(([path]) => path.startsWith(`${folder}/`))
          .map(([path, size]) => ({ name: path.slice(folder.length + 1), size })),
      ),
    // The service role signs any stored file: the handler must check first.
    signRead(path, seconds) {
      if (!files.has(path)) return Promise.resolve(null);
      signed.push({ path, seconds });
      return Promise.resolve(`/object/sign/documents/${path}?token=t`);
    },
    remove(paths) {
      for (const path of paths) files.delete(path);
      return Promise.resolve();
    },
  };

  const live = () => [...rows.values()].filter((r) => !r.deleted_at);
  const handler = createHandler({
    cronSecret: SECRET,
    // Tests use the user ID as the access token.
    authenticate: (token) => Promise.resolve(token in roles ? token : null),
    context: (caller) =>
      Promise.resolve({
        role: roles[caller] ?? null,
        premium: opts.premium ?? false,
        documents: (opts.documents ?? 0) + live().length,
        bytes: (opts.bytes ?? 0) + live().reduce((sum, r) => sum + r.size_bytes, 0),
        limits: LIMITS,
      }),
    create(row) {
      if (rows.has(row.id)) return Promise.resolve('exists' as const);
      rows.set(row.id, { ...row, deleted_at: null });
      readers.set(row.id, new Set([PARENT]));
      return Promise.resolve('ok' as const);
    },
    find: (id) => Promise.resolve((rows.get(id) as StoredDocument | undefined) ?? null),
    canRead(caller, id) {
      checks.push({ caller, id });
      return Promise.resolve(readers.get(id)?.has(caller) ?? false);
    },
    markReady(id) {
      rows.get(id)!.status = 'ready';
      return Promise.resolve();
    },
    storage,
    removeStale: () => Promise.resolve(0),
    claimPurge: (batch) => Promise.resolve(queue.splice(0, batch)),
    finishPurge: () => Promise.resolve(),
    log: (event, fields) => logs.push(JSON.stringify({ event, ...fields })),
  });

  const call = (token: string | null, body: unknown) =>
    handler(
      new Request('http://functions/documents', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: JSON.stringify(body),
      }),
    );
  const begin = (token: string, overrides: Record<string, unknown> = {}) =>
    call(token, {
      action: 'begin',
      household_id: H,
      document_id: newId(),
      title: 'Insurance card',
      category: 'doc.insurance',
      mime: 'image/jpeg',
      files: [{ size: 300_000 }, { size: 200_000 }],
      ...overrides,
    });
  /** Uploads every file `begin` handed out a token for, at the declared sizes. */
  const upload = (uploads: { path: string }[], sizes: number[]) =>
    uploads.forEach(({ path }, i) => files.set(path, sizes[i]));
  const deleteDocument = (id: string) => {
    const row = rows.get(id)!;
    row.deleted_at = new Date().toISOString();
    queue.push({ id: queue.length + 1, prefix: `${row.household_id}/${row.id}/` });
  };

  return { call, begin, upload, rows, files, signed, checks, logs, readers, deleteDocument };
}

async function code(res: Response) {
  return ((await res.json()) as { error?: { code: string } }).error?.code;
}

Deno.test(
  'the 25th document on Free is accepted and the 26th refused (FR2-DOC-8, D-15)',
  async () => {
    const w = world({ documents: 24 });
    assertEquals((await w.begin(PARENT)).status, 200);
    const res = await w.begin(PARENT);
    assertEquals(res.status, 402);
    assertEquals(await code(res), 'documents.limit');
    assertEquals(w.rows.size, 1);
  },
);

Deno.test('Premium holds up to 2 GB, then refuses', async () => {
  const w = world({ premium: true, documents: 500, bytes: 2 * 1024 * MB - 400_000 });
  const res = await w.begin(PARENT);
  assertEquals(res.status, 402);
  assertEquals(await code(res), 'documents.limit');
  assertEquals((await w.begin(PARENT, { files: [{ size: 300_000 }] })).status, 200);
});

Deno.test('a file over 10 MB is refused, and so are more than 20 pages (FR2-DOC-2)', async () => {
  const w = world();
  const big = await w.begin(PARENT, { mime: 'application/pdf', files: [{ size: 10 * MB + 1 }] });
  assertEquals(big.status, 413);
  assertEquals(await code(big), 'documents.file_too_large');
  const pages = await w.begin(PARENT, {
    files: Array.from({ length: 21 }, () => ({ size: 1000 })),
  });
  assertEquals(await code(pages), 'documents.too_many_pages');
  assertEquals(w.rows.size, 0);
});

Deno.test('a caregiver cannot upload (spec section 2, V1)', async () => {
  const w = world({ premium: true });
  const res = await w.begin(CAREGIVER);
  assertEquals(res.status, 403);
  assertEquals(await code(res), 'documents.forbidden');
  assertEquals(w.rows.size, 0);
});

Deno.test('requests without a session, or with bad input, are refused', async () => {
  const w = world();
  assertEquals((await w.call(null, { action: 'begin' })).status, 401);
  assertEquals((await w.call('stranger', { action: 'begin' })).status, 401);
  assertEquals(await code(await w.begin(PARENT, { category: 'Medical' })), 'documents.invalid');
  assertEquals(await code(await w.begin(PARENT, { title: '  ' })), 'documents.invalid');
  const pdfPages = await w.begin(PARENT, {
    mime: 'application/pdf',
    files: [{ size: 1 }, { size: 1 }],
  });
  assertEquals(await code(pdfPages), 'documents.invalid');
});

Deno.test(
  'begin creates the row as uploading, with one token per page under the household',
  async () => {
    const w = world();
    const res = await w.begin(PARENT);
    const body = await res.json();
    const row = w.rows.get(body.document_id)!;
    assertEquals(row.status, 'uploading');
    assertEquals(row.size_bytes, 500_000);
    assertEquals(row.page_count, 2);
    assertEquals(row.created_by, PARENT);
    assertEquals(
      body.uploads.map((u: { path: string }) => u.path),
      [`${H}/${body.document_id}/1.jpg`, `${H}/${body.document_id}/2.jpg`],
    );
  },
);

Deno.test(
  'finish marks the document ready only once every file is stored as declared',
  async () => {
    const w = world();
    const { document_id, uploads } = await (await w.begin(PARENT)).json();
    w.upload(uploads.slice(0, 1), [300_000]);
    const early = await w.call(PARENT, { action: 'finish', document_id });
    assertEquals(await code(early), 'documents.upload_incomplete');
    assertEquals(w.rows.get(document_id)!.status, 'uploading');

    w.upload(uploads, [300_000, 900_000]);
    assertEquals(
      await code(await w.call(PARENT, { action: 'finish', document_id })),
      'documents.upload_incomplete',
    );

    w.upload(uploads, [300_000, 200_000]);
    assertEquals((await w.call(PARENT, { action: 'finish', document_id })).status, 200);
    assertEquals(w.rows.get(document_id)!.status, 'ready');
    // Only the parent who began it finishes it.
    assertEquals((await w.call(CAREGIVER, { action: 'finish', document_id })).status, 404);
  },
);

Deno.test(
  'a member with access gets 60-second links, signed by the server after its check (R2-DOC-2, D-22)',
  async () => {
    const w = world({ premium: true });
    const { document_id, uploads } = await (await w.begin(PARENT)).json();
    w.upload(uploads, [300_000, 200_000]);
    assertEquals((await w.call(PARENT, { action: 'read', document_id })).status, 404);
    await w.call(PARENT, { action: 'finish', document_id });

    const res = await w.call(PARENT, { action: 'read', document_id });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.expires_in, 60);
    assertEquals(body.links.length, 2);
    assertEquals(w.signed.length, 2);
    assert(w.signed.every((s) => s.seconds === 60));
    assertEquals(w.checks.at(-1), { caller: PARENT, id: document_id });
  },
);

async function readyDocument(w: ReturnType<typeof world>) {
  const { document_id, uploads } = await (await w.begin(PARENT)).json();
  w.upload(uploads, [300_000, 200_000]);
  await w.call(PARENT, { action: 'finish', document_id });
  return document_id as string;
}

Deno.test(
  'a caregiver without a share gets the not-found answer; with one they read (D-16)',
  async () => {
    const w = world({ premium: true });
    const document_id = await readyDocument(w);

    const refused = await w.call(CAREGIVER, { action: 'read', document_id });
    assertEquals(refused.status, 404);
    assertEquals(await code(refused), 'documents.not_found');
    assertEquals(w.signed.length, 0, 'nothing is signed for a refused caller');

    w.readers.get(document_id)!.add(CAREGIVER);
    assertEquals((await w.call(CAREGIVER, { action: 'read', document_id })).status, 200);
  },
);

Deno.test('another household gets the same answer as a missing document (NFR2-SEC-1)', async () => {
  const w = world({ premium: true });
  const document_id = await readyDocument(w);

  const refused = await w.call(OTHER_PARENT, { action: 'read', document_id });
  const missing = await w.call(OTHER_PARENT, { action: 'read', document_id: newId() });
  assertEquals([refused.status, missing.status], [404, 404]);
  assertEquals(await refused.json(), await missing.json());
  assertEquals(w.signed.length, 0);
});

Deno.test("a deleted document's files are gone after one purge run (R2-DOC-4)", async () => {
  const w = world();
  const { document_id, uploads } = await (await w.begin(PARENT)).json();
  w.upload(uploads, [300_000, 200_000]);
  await w.call(PARENT, { action: 'finish', document_id });
  const other = await (await w.begin(PARENT, { files: [{ size: 10 }] })).json();
  w.upload(other.uploads, [10]);

  w.deleteDocument(document_id);
  assertEquals((await w.call(PARENT, { action: 'read', document_id })).status, 404);
  assertEquals((await w.call(PARENT, { action: 'purge' })).status, 401);

  const res = await w.call(SECRET, { action: 'purge' });
  assertEquals(await res.json(), { stale: 0, folders: 1, files: 2, failed: 0 });
  assertEquals(
    [...w.files.keys()].filter((p) => p.includes(document_id)),
    [],
  );
  assertEquals(w.files.size, 1, 'other documents keep their files');
});

Deno.test('logs carry counts only, never titles or categories (NFR2-SEC-2)', async () => {
  const w = world();
  const { document_id, uploads } = await (
    await w.begin(PARENT, { category: 'doc.medical' })
  ).json();
  w.upload(uploads, [300_000, 200_000]);
  await w.call(PARENT, { action: 'finish', document_id });
  const text = w.logs.join('\n');
  assert(!text.includes('Insurance') && !text.includes('doc.') && !text.includes(document_id));
});
