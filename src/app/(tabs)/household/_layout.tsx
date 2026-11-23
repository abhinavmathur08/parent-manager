import { Stack } from 'expo-router';

import { usePendingUploadRunner } from '@/features/documents/add-queue';
import { useOnline } from '@/hooks/use-online';

/**
 * The Household tab's hub (S-25) and the screens it opens, such as members (S-26), people
 * (S-28) and the document vault (S-40). Documents added offline upload from here when the
 * device is back online (NFR2-OFF-1).
 */
export default function HouseholdLayout() {
  usePendingUploadRunner(useOnline());
  return <Stack screenOptions={{ headerShown: false }} />;
}
