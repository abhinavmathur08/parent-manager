import { Platform } from 'react-native';

/**
 * Where the user manages store subscriptions. Deleting an account doesn't cancel one
 * (spec FR-PRIV-3 edge cases), so the confirmation links here.
 */
export function storeSubscriptionsUrl(os: string = Platform.OS): string {
  return os === 'android'
    ? 'https://play.google.com/store/account/subscriptions'
    : 'https://apps.apple.com/account/subscriptions';
}
