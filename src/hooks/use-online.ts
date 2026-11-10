import { useNetworkState } from 'expo-network';

/**
 * Whether the device looks online. Unknown counts as online, so a slow first network check
 * never blocks the user; a request that then fails shows the network error instead.
 */
export function useOnline(): boolean {
  const state = useNetworkState();
  return state.isConnected !== false && state.isInternetReachable !== false;
}
