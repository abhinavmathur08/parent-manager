import * as LocalAuthentication from 'expo-local-authentication';

/** What this device can unlock with. */
export type UnlockMethod = 'faceId' | 'fingerprint' | 'iris' | 'passcode' | 'none';

/**
 * The best method the device has enrolled. Biometrics come first; a device with only a
 * passcode can still use the lock, because the passcode is the fallback (FR-AUTH-6).
 */
export async function unlockMethod(): Promise<UnlockMethod> {
  const level = await LocalAuthentication.getEnrolledLevelAsync();
  if (level === LocalAuthentication.SecurityLevel.NONE) return 'none';
  if (level === LocalAuthentication.SecurityLevel.SECRET) return 'passcode';
  const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) return 'faceId';
  if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) return 'fingerprint';
  if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) return 'iris';
  return 'passcode';
}

export type UnlockResult = 'unlocked' | 'cancelled' | 'unavailable';

/** Shows the system prompt: biometrics, with the device passcode as the fallback. */
export async function authenticate(
  promptMessage: string,
  cancelLabel: string,
): Promise<UnlockResult> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage,
    cancelLabel,
    disableDeviceFallback: false,
  });
  if (result.success) return 'unlocked';
  // Nothing to unlock with any more: no biometrics enrolled and no passcode.
  if (
    result.error === 'not_enrolled' ||
    result.error === 'passcode_not_set' ||
    result.error === 'not_available'
  ) {
    return (await unlockMethod()) === 'none' ? 'unavailable' : 'cancelled';
  }
  return 'cancelled';
}
