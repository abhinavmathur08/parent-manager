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

/** Real starts of each stored type, padded to 8 bytes. */
const SIGNED = {
  pdf: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]),
  jpg: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]),
  png: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
};

let next = 0;
const newId = () => `dddddddd-0000-0000-0000-${String(++next).padStart(12, '0')}`;

/** An in-memory household, bucket and purge queue, shaped like the database and Storage. */
function world(opts: { documents?: number; bytes?: number; premium?: boolean } = {}) {
  const rows = new Map<string, NewDocument & { deleted_at: string | null }>();
  const files = new Map<string, number>();
  /** Files' first bytes; a file without an entry starts with its extension's real signature. */
  const heads = new Map<string, Uint8Array>();
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
    // Like Storage: only what is directly in the folder.
    list: (folder) =>
      Promise.resolve(
        [...files]
          .map(([path, size]) => ({ name: path.slice(folder.length + 1), size, path }))
          .filter(({ path, name }) => path.startsWith(`${folder}/`) && !name.includes('/'))
          .map(({ name, size }) => ({ name, size })),
      ),
    folders: (folder) =>
      Promise.resolve([
        ...new Set(
          [...files.keys()]
            .filter((path) => path.startsWith(`${folder}/`))
            .map((path) => path.slice(folder.length + 1).split('/'))
            .filter((parts) => parts.length > 1)
            .map((parts) => parts[0]),
        ),
      ]),
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
    head(path, length) {
      if (!files.has(path)) return Promise.resolve(null);
      const ext = path.split('.').pop() as keyof typeof SIGNED;
      return Promise.resolve((heads.get(path) ?? SIGNED[ext]).subarray(0, length));
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

  /** What `erase_household` does: hard-deletes the rows, each queuing its folder, then the household's. */
  const deleteHousehold = (household: string) => {
    for (const row of [...rows.values()]) {
      if (row.household_id !== household) continue;
      rows.delete(row.id);
      if (!row.deleted_at) queue.push({ id: queue.length + 1, prefix: `${household}/${row.id}/` });
    }
    queue.push({ id: queue.length + 1, prefix: `${household}/` });
  };

  return {
    call,
    begin,
    upload,
    rows,
    files,
    heads,
    signed,
    checks,
    logs,
    readers,
    deleteDocument,
    deleteHousehold,
  };
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

Deno.test('finish accepts each stored type whose bytes match it (SR2-L3)', async () => {
  for (const [mime, files] of [
    ['application/pdf', [{ size: 300_000 }]],
    ['image/jpeg', [{ size: 300_000 }, { size: 200_000 }]],
    ['image/png', [{ size: 300_000 }]],
  ] as const) {
    const w = world();
    const { document_id, uploads } = await (await w.begin(PARENT, { mime, files })).json();
    w.upload(
      uploads,
      files.map((f) => f.size),
    );
    assertEquals((await w.call(PARENT, { action: 'finish', document_id })).status, 200, mime);
    assertEquals(w.rows.get(document_id)!.status, 'ready');
  }
});

Deno.test(
  'finish refuses a file whose bytes are not its declared type, and logs no content (SR2-L3)',
  async () => {
    const w = world();
    const { document_id, uploads } = await (await w.begin(PARENT)).json();
    w.upload(uploads, [300_000, 200_000]);
    // Page 2 is labelled a JPEG but holds a PNG; then HTML; then too few bytes.
    for (const bytes of [
      SIGNED.png,
      new TextEncoder().encode('<html><script>'),
      new Uint8Array([0xff, 0xd8]),
    ]) {
      w.heads.set(uploads[1].path, bytes);
      const res = await w.call(PARENT, { action: 'finish', document_id });
      assertEquals(res.status, 400);
      assertEquals(await code(res), 'documents.invalid');
      assertEquals(w.rows.get(document_id)!.status, 'uploading');
    }
    assertEquals(JSON.parse(w.logs.at(-1)!), {
      event: 'documents.wrong_type',
      pages: 2,
    });

    w.heads.delete(uploads[1].path);
    assertEquals((await w.call(PARENT, { action: 'finish', document_id })).status, 200);
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

Deno.test('a deleted household leaves no stored file behind (FR2-PRIV-2, A-05)', async () => {
  const w = world();
  const first = await (await w.begin(PARENT)).json();
  w.upload(first.uploads, [300_000, 200_000]);
  await w.call(PARENT, { action: 'finish', document_id: first.document_id });
  const second = await (await w.begin(PARENT, { files: [{ size: 10 }] })).json();
  w.upload(second.uploads, [10]);
  w.deleteDocument(first.document_id);
  // A file no row names, such as a folder an earlier purge failed on.
  w.files.set(`${H}/${newId()}/1.jpg`, 5);
  const elsewhere = `00000000-0000-0000-0000-00000000000b/${newId()}/1.pdf`;
  w.files.set(elsewhere, 7);

  w.deleteHousehold(H);
  const res = await w.call(SECRET, { action: 'purge' });
  assertEquals(res.status, 200);
  assertEquals((await res.json()).failed, 0);
  assertEquals([...w.files.keys()], [elsewhere], 'only the other household keeps its file');
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
