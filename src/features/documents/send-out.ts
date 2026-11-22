import { Directory, File } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { track } from '@/lib/analytics';

import { downloadPages, readLinks } from './read';
import { openViewerCache } from './vault/viewer-cache';

const UTI: Record<string, string> = {
  'application/pdf': 'com.adobe.pdf',
  'image/jpeg': 'public.jpeg',
  'image/png': 'public.png',
};

/** A printable page per scanned image, so a multi-page scan goes out as one PDF. */
export function pagesHtml(images: readonly string[]): string {
  const pages = images
    .map(
      (data) =>
        `<div style="page-break-after:always"><img src="data:image/jpeg;base64,${data}" style="width:100%"/></div>`,
    )
    .join('');
  return `<html><body style="margin:0">${pages}</body></html>`;
}

function remove(uri: string | null) {
  if (!uri) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Already gone.
  }
}

/**
 * Save or send out (FR2-DOC-9): always free, for parents. The files are fetched from fresh
 * signed links into the open document's cache folder, handed to the share sheet, and deleted
 * as soon as it closes. A PDF or a single image goes as it is; a scan of several pages goes
 * as one PDF made on the device. Nothing in the document is read (FR2-DOC-11).
 */
export async function sendOutDocument(documentId: string, dialogTitle: string): Promise<void> {
  const folder = new Directory(openViewerCache(documentId), 'out');
  let printed: string | null = null;
  try {
    if (!folder.exists) folder.create({ intermediates: true, idempotent: true });
    const { mime, links } = await readLinks(documentId);
    const files = await downloadPages(links, folder, mime);
    let uri = files[0];
    let type: string = mime;
    if (files.length > 1) {
      const images = await Promise.all(files.map((file) => new File(file).base64()));
      printed = (await Print.printToFileAsync({ html: pagesHtml(images) })).uri;
      uri = printed;
      type = 'application/pdf';
    }
    await Sharing.shareAsync(uri, { mimeType: type, UTI: UTI[type], dialogTitle });
    track('document_sent_out', {});
  } finally {
    remove(printed);
    try {
      if (folder.exists) folder.delete();
    } catch {
      // The viewer's folder goes when it closes anyway.
    }
  }
}
