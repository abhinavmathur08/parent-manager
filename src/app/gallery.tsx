import { Redirect } from 'expo-router';

import { GalleryScreen } from '@/features/gallery/gallery-screen';

/** The component gallery, in development builds only (F-06.5). */
export default function Gallery() {
  if (!__DEV__) return <Redirect href="/plan" />;
  return <GalleryScreen />;
}
