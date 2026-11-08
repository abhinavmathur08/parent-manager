// Jest stand-in for expo-crypto's AES API, backed by the WebCrypto global so tests run
// real AES-256-GCM. Sealed data uses expo-crypto's combined layout: 12-byte IV, then
// ciphertext with its 16-byte tag.
const IV_LENGTH = 12;

export function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  if (!/^(?:[0-9a-f]{2})*$/i.test(hex)) {
    throw new Error('Invalid hex');
  }
  return Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
}

export class AESEncryptionKey {
  constructor(readonly raw: Uint8Array<ArrayBuffer>) {}

  static async generate(): Promise<AESEncryptionKey> {
    return new AESEncryptionKey(crypto.getRandomValues(new Uint8Array(32)));
  }

  static async import(encoded: string, encoding: 'hex' | 'base64'): Promise<AESEncryptionKey> {
    const raw = encoding === 'hex' ? fromHex(encoded) : base64ToBytes(encoded);
    if (raw.length !== 32) {
      throw new Error('Invalid key length');
    }
    return new AESEncryptionKey(raw);
  }

  async encoded(encoding: 'hex' | 'base64'): Promise<string> {
    return encoding === 'hex' ? toHex(this.raw) : bytesToBase64(this.raw);
  }
}

export class AESSealedData {
  constructor(readonly bytes: Uint8Array<ArrayBuffer>) {}

  static fromCombined(combined: string): AESSealedData {
    return new AESSealedData(base64ToBytes(combined));
  }

  async combined(): Promise<string> {
    return bytesToBase64(this.bytes);
  }
}

function importKey(key: AESEncryptionKey) {
  return crypto.subtle.importKey('raw', key.raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function aesEncryptAsync(
  plaintextBase64: string,
  key: AESEncryptionKey,
): Promise<AESSealedData> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      await importKey(key),
      base64ToBytes(plaintextBase64),
    ),
  );
  const combined = new Uint8Array(iv.length + ciphertext.length);
  combined.set(iv);
  combined.set(ciphertext, iv.length);
  return new AESSealedData(combined);
}

export async function aesDecryptAsync(
  sealed: AESSealedData,
  key: AESEncryptionKey,
): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: sealed.bytes.slice(0, IV_LENGTH) },
    await importKey(key),
    sealed.bytes.slice(IV_LENGTH),
  );
  return bytesToBase64(new Uint8Array(plaintext));
}
