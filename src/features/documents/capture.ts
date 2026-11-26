import { CameraView } from 'expo-camera';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { fileMatchesType } from './file-type';
import { DOCUMENT_LIMITS, type DocumentMime } from './tables';

/** FR2-DOC-2: at most 10 MB a file. The server checks it too, from `documents.limits`. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Architecture 3.5 (PROPOSED): pages and photos are resized to this long edge, as JPEG. */
export const MAX_PAGE_EDGE = 2000;
const JPEG_QUALITY = 0.7;

export type CaptureSource = 'scan' | 'photo' | 'file';

export type CapturedFile = { uri: string; size: number };

/** What the member scanned, photographed or picked, ready to upload. */
export type Capture = {
  source: CaptureSource;
  mime: DocumentMime;
  /** Scanned pages in order; a photo, an image or a PDF is one file. */
  files: CapturedFile[];
  /** The scan had more than 20 pages, and only the first 20 were kept (FR2-DOC-2). */
  truncated: boolean;
};

export type CaptureOutcome =
  | { status: 'captured'; capture: Capture }
  | { status: 'canceled' }
  /** The camera permission is off; `canAskAgain` false means only Settings can turn it on. */
  | { status: 'denied'; canAskAgain: boolean }
  | { status: 'too_large' }
  | { status: 'unsupported' }
  | { status: 'failed' };

/** Types a picked file may have (FR2-DOC-2). HEIC is converted to JPEG on the device. */
export const PICKABLE_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
] as const;

/** Whether this device has the system document scanner (architecture 3.5, V-01). */
export function scannerAvailable(): boolean {
  try {
    return CameraView.isDocumentScannerAvailable === true;
  } catch {
    return false;
  }
}

/** The resize that brings the long edge down to MAX_PAGE_EDGE, or null if it's already small. */
export function fitPage(width: number, height: number) {
  if (Math.max(width, height) <= MAX_PAGE_EDGE) return null;
  return width >= height
    ? { width: MAX_PAGE_EDGE, height: null }
    : { width: null, height: MAX_PAGE_EDGE };
}

/** The type a picked file is stored as, or null for one we don't accept. */
export function storedMime(mimeType: string | null | undefined, name: string): DocumentMime | null {
  const type = (mimeType ?? '').toLowerCase();
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (type === 'application/pdf' || ext === 'pdf') return 'application/pdf';
  if (type === 'image/png' || ext === 'png') return 'image/png';
  if (['image/jpeg', 'image/jpg', 'image/heic', 'image/heif'].includes(type)) return 'image/jpeg';
  if (['jpg', 'jpeg', 'heic', 'heif'].includes(ext)) return 'image/jpeg';
  return null;
}

export function fileSize(uri: string): number {
  return new File(uri).size ?? 0;
}

/** Deletes captured files from the cache, after an upload or a cancel. */
export function discardCapture(capture: Pick<Capture, 'files'>): void {
  for (const file of capture.files) {
    try {
      const handle = new File(file.uri);
      if (handle.exists) handle.delete();
    } catch {
      // Already gone.
    }
  }
}

/** Resizes an image and saves it as JPEG in the cache (HEIC, photos and scanned pages). */
async function toJpeg(uri: string, width: number, height: number): Promise<CapturedFile> {
  const context = ImageManipulator.manipulate(uri);
  const resize = fitPage(width, height);
  if (resize) context.resize(resize);
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY });
  return { uri: saved.uri, size: fileSize(saved.uri) };
}

function checked(capture: Capture): CaptureOutcome {
  if (capture.files.some((file) => file.size > MAX_FILE_BYTES || file.size <= 0)) {
    discardCapture(capture);
    return capture.files.some((file) => file.size > MAX_FILE_BYTES)
      ? { status: 'too_large' }
      : { status: 'failed' };
  }
  return { status: 'captured', capture };
}

/**
 * Scans with the system scanner: edge detection, cropping and many pages (FR2-DOC-2). The
 * scanner can't be capped, so only the first 20 pages are kept, and the screen says so.
 */
export async function scan(): Promise<CaptureOutcome> {
  const result = await CameraView.scanDocumentAsync({ quality: 1 });
  if (!result || result.pages.length === 0) return { status: 'canceled' };
  const kept = result.pages.slice(0, DOCUMENT_LIMITS.pages);
  try {
    const files: CapturedFile[] = [];
    for (const page of kept) {
      const { width, height } = await ImageManipulator.manipulate(page).renderAsync();
      files.push(await toJpeg(page, width, height));
    }
    return checked({
      source: 'scan',
      mime: 'image/jpeg',
      files,
      truncated: result.pages.length > kept.length,
    });
  } catch {
    return { status: 'failed' };
  } finally {
    discardCapture({ files: result.pages.map((uri) => ({ uri, size: 0 })) });
  }
}

/** Takes one photo, asking for the camera only now. No edge detection (architecture 3.5). */
export async function takePhoto(): Promise<CaptureOutcome> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return { status: 'denied', canAskAgain: permission.canAskAgain };
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return { status: 'canceled' };
  try {
    const file = await toJpeg(asset.uri, asset.width, asset.height);
    return checked({ source: 'photo', mime: 'image/jpeg', files: [file], truncated: false });
  } catch {
    return { status: 'failed' };
  }
}

/** Picks a PDF or an image through the system picker, which needs no permission. */
export async function pickFile(): Promise<CaptureOutcome> {
  const result = await DocumentPicker.getDocumentAsync({
    type: [...PICKABLE_TYPES],
    copyToCacheDirectory: true,
    multiple: false,
  });
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return { status: 'canceled' };
  const mime = storedMime(asset.mimeType, asset.name);
  if (!mime) {
    discardCapture({ files: [{ uri: asset.uri, size: 0 }] });
    return { status: 'unsupported' };
  }
  try {
    const original = { uri: asset.uri, size: asset.size ?? fileSize(asset.uri) };
    // PDFs and PNGs are stored as they are, so their bytes must be what the name says (SR2-L3);
    // JPEG and HEIC become a resized JPEG.
    let file = original;
    if (mime !== 'image/jpeg' && !fileMatchesType(asset.uri, mime)) {
      discardCapture({ files: [original] });
      return { status: 'unsupported' };
    }
    if (mime === 'image/jpeg') {
      const { width, height } = await ImageManipulator.manipulate(asset.uri).renderAsync();
      file = await toJpeg(asset.uri, width, height);
      discardCapture({ files: [original] });
    }
    return checked({ source: 'file', mime, files: [file], truncated: false });
  } catch {
    return { status: 'failed' };
  }
}
