import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { usePushPrompt } from '@/features/notifications/push-prompt';
import { PushStatus } from '@/features/notifications/push-status';
import type { PushPermission } from '@/lib/notifications/push';

let mockPermission: PushPermission = 'undetermined';
const mockRequest = jest.fn(async (..._args: unknown[]) => 'granted');
jest.mock('@/lib/notifications/push', () => ({
  readPushPermission: async () => mockPermission,
  requestPushPermission: (...args: unknown[]) => mockRequest(...args),
}));
const mockStore = new Map<string, string>();
jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: {
    getItemSync: (key: string) => mockStore.get(key) ?? null,
    setItemSync: (key: string, value: string) => mockStore.set(key, value),
  },
}));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function Harness({ userId, onReady }: { userId: string; onReady: (offer: () => void) => void }) {
  const prompt = usePushPrompt(userId);
  onReady(prompt.offer);
  return <SafeAreaProvider initialMetrics={metrics}>{prompt.sheet}</SafeAreaProvider>;
}

async function renderPrompt(userId = 'user-1') {
  let offer: () => void = () => undefined;
  await render(<Harness userId={userId} onReady={(o) => (offer = o)} />);
  return async () => {
    await act(async () => {
      offer();
      await Promise.resolve();
    });
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  mockPermission = 'undetermined';
});

describe('push prompt in context (FR-NOT-2, FR-ONB-8)', () => {
  it('stays hidden until the week is planned', async () => {
    await renderPrompt();
    expect(screen.queryByTestId('push-prompt-turn-on')).toBeNull();
  });

  it('explains, then asks the system when the member turns notifications on', async () => {
    const offer = await renderPrompt();
    await offer();
    expect(screen.getByTestId('push-prompt-body')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('push-prompt-turn-on'));
    expect(mockRequest).toHaveBeenCalledWith('week_planned', 'Reminders');
  });

  it('is offered once per member: "Not now" sticks', async () => {
    const offer = await renderPrompt();
    await offer();
    await fireEvent.press(screen.getByTestId('push-prompt-not-now'));
    // The sheet animates out before it unmounts.
    await waitFor(() => expect(screen.queryByTestId('push-prompt-turn-on')).toBeNull());
    await offer();
    expect(screen.queryByTestId('push-prompt-turn-on')).toBeNull();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('is not offered when the system can no longer ask, or already said yes', async () => {
    mockPermission = 'denied';
    let offer = await renderPrompt('user-2');
    await offer();
    expect(screen.queryByTestId('push-prompt-turn-on')).toBeNull();
    mockPermission = 'granted';
    offer = await renderPrompt('user-3');
    await offer();
    expect(screen.queryByTestId('push-prompt-turn-on')).toBeNull();
  });

  it('needs a signed-in member', async () => {
    const hook = await renderHook(() => usePushPrompt(null));
    await act(async () => hook.result.current.offer());
    expect(mockStore.size).toBe(0);
  });
});

describe('push status on S-29 (FR-NOT-2)', () => {
  const props = { onTurnOn: jest.fn(), onOpenSystemSettings: jest.fn() };

  it('says "off in system settings" with a link when denied', async () => {
    await render(<PushStatus permission="denied" {...props} />);
    expect(screen.getByText(/Off in system settings/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('push-open-settings'));
    expect(props.onOpenSystemSettings).toHaveBeenCalled();
  });

  it('offers to turn push on when not asked yet', async () => {
    await render(<PushStatus permission="undetermined" {...props} />);
    await fireEvent.press(screen.getByTestId('push-turn-on'));
    expect(props.onTurnOn).toHaveBeenCalled();
  });

  it('shows on when granted', async () => {
    await render(<PushStatus permission="granted" {...props} />);
    expect(screen.getByText('On')).toBeTruthy();
  });
});
