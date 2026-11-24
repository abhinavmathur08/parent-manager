import { Stack } from 'expo-router';

import { usePendingUploadRunner } from '@/features/documents/add-queue';
import { useOnline } from '@/hooks/use-online';

/**
 * The Calendar tab (S-36) and the screens it opens. Documents added from an event offline
 * upload from here too when the device is back online (NFR2-OFF-1).
 */
export default function CalendarLayout() {
  usePendingUploadRunner(useOnline());
  return <Stack screenOptions={{ headerShown: false }} />;
}
