import { MockStoreScreen } from '@/features/subscription/mock-store-screen';

// The mock store's settings and test clock (M-02.2). The screen shows nothing useful unless
// the build allows the mock store and the server has it turned on.
export default function MockStoreRoute() {
  return <MockStoreScreen />;
}
