import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import type { ImportInput } from './api';

/** FR-AI-12 (PROPOSED): images are shrunk on the device to this long edge before upload. */
export const MAX_IMAGE_EDGE = 1600;
const JPEG_QUALITY = 0.7;

export type ImageInput = Extract<ImportInput, { type: 'image' }>;

export type PickOutcome =
  | { status: 'picked'; input: ImageInput }
  | { status: 'canceled' }
  /** The camera permission is off; `canAskAgain` false means only Settings can turn it on. */
  | { status: 'denied'; canAskAgain: boolean }
  | { status: 'failed' };

/** The resize that brings the long edge down to MAX_IMAGE_EDGE, or null if it's already small. */
export function fitLongEdge(width: number, height: number) {
  if (Math.max(width, height) <= MAX_IMAGE_EDGE) return null;
  return width >= height
    ? { width: MAX_IMAGE_EDGE, height: null }
    : { width: null, height: MAX_IMAGE_EDGE };
}

/** A library image is a screenshot when its name says so; anything else counts as a photo. */
export function kindOf(asset: { fileName?: string | null }, from: 'camera' | 'library') {
  if (from === 'camera') return 'photo' as const;
  return /screen ?shot/i.test(asset.fileName ?? '') ? ('screenshot' as const) : ('photo' as const);
}

/**
 * Takes a photo or picks one image (FR-AI-1), asking for camera access only now, the first
 * time it's needed. The photo library opens through the system picker, which needs no
 * permission. The image is shrunk and compressed to a JPEG in the app's cache (FR-AI-12).
 */
export async function pickImage(from: 'camera' | 'library'): Promise<PickOutcome> {
  if (from === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { status: 'denied', canAskAgain: permission.canAskAgain };
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };
  const result =
    from === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return { status: 'canceled' };
  try {
    const context = ImageManipulator.manipulate(asset.uri);
    const resize = fitLongEdge(asset.width, asset.height);
    if (resize) context.resize(resize);
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY });
    return {
      status: 'picked',
      input: { type: 'image', kind: kindOf(asset, from), uri: saved.uri, mediaType: 'image/jpeg' },
    };
  } catch {
    return { status: 'failed' };
  }
}

/** The compressed image as base64, for the request body. */
export function readImage(input: ImageInput): Promise<string> {
  return new File(input.uri).base64();
}

/** Deletes the compressed copy once the import no longer needs it. */
export function discardImage(input: ImportInput | undefined): void {
  if (input?.type !== 'image') return;
  try {
    const file = new File(input.uri);
    if (file.exists) file.delete();
  } catch {
    // The cache is cleared by the system anyway.
  }
}
