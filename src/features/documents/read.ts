import { Directory, File } from 'expo-file-system';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { track } from '@/lib/analytics';
import { supabaseConfig } from '@/lib/supabase-config';

import { callDocuments, UploadError, type UploadErrorCode } from './upload';
import type { DocumentMime } from './tables';
import { clearViewerCache, useViewerCache } from './vault/viewer-cache';

/** What `read` returns: links that expire after `expires_in` seconds (R2-DOC-2, D-22). */
export type ReadLinks = { mime: DocumentMime; links: string[] };

/** The origin every signed link points at; the PDF view never leaves it. */
export function storageOrigin(): string | null {
  if (!supabaseConfig) return null;
  try {
    return new URL(supabaseConfig.url).origin;
  } catch {
    return null;
  }
}

/** A signed link is relative to `/storage/v1` on the project's URL (V-02.3). */
export function absoluteLink(link: string): string {
  if (!supabaseConfig) throw new UploadError('documents.unavailable');
  return `${supabaseConfig.url.replace(/\/$/, '')}/storage/v1${link}`;
}

/** Asks the documents function, the only issuer, for 60-second read links (D-22). */
export async function readLinks(documentId: string): Promise<ReadLinks> {
  const data = await callDocuments<{ mime: DocumentMime; links: string[] }>({
    action: 'read',
    document_id: documentId,
  });
  return { mime: data.mime, links: data.links.map(absoluteLink) };
}

const EXTENSIONS: Record<DocumentMime, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

/** Downloads each file into the open document's cache folder, in page order. */
export async function downloadPages(
  links: readonly string[],
  folder: Directory,
  mime: DocumentMime,
) {
  return Promise.all(
    links.map(async (link, index) => {
      const target = new File(folder, `${index + 1}.${EXTENSIONS[mime]}`);
      if (target.exists) target.delete();
      const file = await File.downloadFileAsync(link, target);
      return file.uri;
    }),
  );
}

export type PagesState =
  | { status: 'loading' }
  | { status: 'offline' }
  /** Page images in the viewer's cache folder. */
  | { status: 'images'; uris: string[] }
  /** iOS shows a PDF from its signed link in a web view that keeps nothing (architecture 3.5). */
  | { status: 'pdf'; url: string }
  /** Android has no PDF viewer yet (architecture 3.5): details and send out only. */
  | { status: 'pdf_unsupported' }
  | { status: 'error'; code: UploadErrorCode };

/**
 * Loads a document's pages for S-42 (FR2-DOC-4): signed links from the server, then the page
 * images into the viewer's cache folder, which goes when the viewer closes. A PDF on iOS
 * isn't downloaded at all. Records `document_viewed` once the pages are there.
 */
export function useDocumentPages(documentId: string, online: boolean, attempt = 0): PagesState {
  const folder = useViewerCache(documentId);
  const key = `${documentId}:${attempt}`;
  const [result, setResult] = useState<{ key: string; state: PagesState } | null>(null);

  useEffect(() => {
    if (!online) return;
    let active = true;
    const settle = (state: PagesState) => {
      // Closed while downloading: nothing may stay in the cache (FR2-DOC-4).
      if (!active) return clearViewerCache(documentId);
      setResult({ key, state });
    };
    (async (): Promise<PagesState> => {
      const { mime, links } = await readLinks(documentId);
      if (mime === 'application/pdf') {
        return Platform.OS === 'ios'
          ? { status: 'pdf', url: links[0] }
          : { status: 'pdf_unsupported' };
      }
      return { status: 'images', uris: await downloadPages(links, folder, mime) };
    })().then(
      (next) => {
        if (active && next.status !== 'pdf_unsupported') track('document_viewed', {});
        settle(next);
      },
      (error: unknown) =>
        settle({
          status: 'error',
          code: error instanceof UploadError ? error.code : 'documents.network',
        }),
    );
    return () => {
      active = false;
    };
  }, [documentId, key, online, folder]);

  if (!online) return { status: 'offline' };
  if (result?.key !== key) return { status: 'loading' };
  return result.state;
}
