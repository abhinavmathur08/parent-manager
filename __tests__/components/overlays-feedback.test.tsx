import { act, fireEvent, render, renderHook, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AllergenNotice } from '@/components/allergen-notice';
import { Banner } from '@/components/banner';
import { BottomSheet, shouldDismiss } from '@/components/bottom-sheet';
import { CodeInput, sanitizeCode } from '@/components/code-input';
import { EmptyState } from '@/components/empty-state';
import { Skeleton } from '@/components/skeleton';
import { TextField } from '@/components/text-field';
import { Toast } from '@/components/toast';
import { theme } from '@/constants/theme';
import { clearAllDrafts, useDraftState } from '@/hooks/use-draft-state';
import * as reduceMotionModule from '@/hooks/use-reduce-motion';
import { useReduceMotion } from '@/hooks/use-reduce-motion';

jest.mock('expo-sqlite/kv-store', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItemSync: (key: string) => store.get(key) ?? null,
      setItemSync: (key: string, value: string) => void store.set(key, value),
      removeItemSync: (key: string) => store.delete(key),
      getAllKeys: async () => [...store.keys()],
      removeItem: async (key: string) => void store.delete(key),
    },
  };
});

const reduceMotion = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled');
const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');

beforeEach(() => {
  reduceMotion.mockResolvedValue(false);
  announce.mockClear();
});

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, start: 0, end: 0, left: 0, right: 0, bottom: 34 },
};

function withSafeArea(node: React.ReactElement) {
  return <SafeAreaProvider initialMetrics={metrics}>{node}</SafeAreaProvider>;
}

describe('useReduceMotion', () => {
  it('reports the system setting', async () => {
    reduceMotion.mockResolvedValue(true);
    const { result } = await renderHook(() => useReduceMotion());
    expect(result.current).toBe(true);
  });
});

describe('BottomSheet', () => {
  it('shows its title and closes from the close button and the scrim', async () => {
    const onClose = jest.fn();
    await render(
      withSafeArea(
        <BottomSheet visible title="Add a meal" onClose={onClose} testID="sheet">
          {null}
        </BottomSheet>,
      ),
    );
    expect(screen.getByRole('header', { name: 'Add a meal' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    await fireEvent.press(screen.getByTestId('sheet-scrim', { includeHiddenElements: true }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('renders nothing while closed', async () => {
    await render(
      withSafeArea(
        <BottomSheet visible={false} title="Add a meal" onClose={jest.fn()} testID="sheet">
          {null}
        </BottomSheet>,
      ),
    );
    expect(screen.queryByTestId('sheet')).toBeNull();
  });

  it('closes on a long or fast drag only', () => {
    expect(shouldDismiss(40, 0.2)).toBe(false);
    expect(shouldDismiss(120, 0.2)).toBe(true);
    expect(shouldDismiss(30, 2)).toBe(true);
  });

  it('uses a short fade with Reduce Motion on', async () => {
    reduceMotion.mockResolvedValue(true);
    const timing = jest.spyOn(Animated, 'timing');
    await render(
      withSafeArea(
        <BottomSheet visible title="Add a meal" onClose={jest.fn()} testID="sheet">
          {null}
        </BottomSheet>,
      ),
    );
    const durations = timing.mock.calls.map(([, config]) => config.duration);
    expect(durations.at(-1)).toBeLessThanOrEqual(theme.motion.fast);
    timing.mockRestore();
  });

  it('keeps a form draft when the app is killed and reopened', async () => {
    function NoteSheet() {
      const [note, setNote] = useDraftState('test-note', '');
      return (
        <BottomSheet visible variant="form" title="Note" onClose={jest.fn()} testID="sheet">
          <TextField label="Note" value={note} onChangeText={setNote} testID="note" />
        </BottomSheet>
      );
    }
    const first = await render(withSafeArea(<NoteSheet />));
    await fireEvent.changeText(screen.getByTestId('note'), 'Buy oat milk');
    await first.unmount();

    await render(withSafeArea(<NoteSheet />));
    expect(screen.getByTestId('note').props.value).toBe('Buy oat milk');
  });
});

describe('useDraftState', () => {
  it('clears a saved draft', async () => {
    const { result, unmount } = await renderHook(() => useDraftState('test-clear', 'start'));
    await act(async () => result.current[1]('edited'));
    await act(async () => result.current[2]());
    expect(result.current[0]).toBe('start');
    await unmount();
    const again = await renderHook(() => useDraftState('test-clear', 'start'));
    expect(again.result.current[0]).toBe('start');
  });

  it('removes every draft for sign-out', async () => {
    const { result, unmount } = await renderHook(() => useDraftState('test-all', 1));
    await act(async () => result.current[1](2));
    await unmount();
    await clearAllDrafts();
    const again = await renderHook(() => useDraftState('test-all', 1));
    expect(again.result.current[0]).toBe(1);
  });
});

describe('Toast', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('is announced and dismissed after 5 seconds', async () => {
    const onDismiss = jest.fn();
    await render(<Toast visible message="Milk removed" onDismiss={onDismiss} testID="toast" />);
    expect(announce).toHaveBeenCalledWith('Milk removed');
    await act(async () => jest.advanceTimersByTime(4999));
    expect(onDismiss).not.toHaveBeenCalled();
    await act(async () => jest.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('runs undo from a 48 pt action and dismisses', async () => {
    const onAction = jest.fn();
    const onDismiss = jest.fn();
    await render(
      <Toast
        visible
        variant="undo"
        message="Milk removed"
        actionLabel="Undo"
        onAction={onAction}
        onDismiss={onDismiss}
        testID="toast"
      />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Undo' }));
    expect(onAction).toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalled();
    expect(
      StyleSheet.flatten(screen.getByTestId('toast-action').props.style).minHeight,
    ).toBeGreaterThanOrEqual(48);
  });

  it('sits above the tab bar', async () => {
    await render(<Toast visible message="Saved" onDismiss={jest.fn()} testID="toast" />);
    expect(StyleSheet.flatten(screen.getByTestId('toast').props.style).bottom).toBe(
      theme.layout.tabBarClearance,
    );
  });
});

describe('Banner', () => {
  it('cannot dismiss the offline banner', async () => {
    await render(
      <Banner variant="offline" message="You're offline" onDismiss={jest.fn()} testID="b" />,
    );
    expect(screen.getByTestId('b')).toHaveTextContent("You're offline");
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('dismisses an info banner', async () => {
    const onDismiss = jest.fn();
    await render(<Banner variant="info" message="Tip" onDismiss={onDismiss} testID="b" />);
    await fireEvent.press(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalled();
  });
});

describe('EmptyState', () => {
  it('shows one sentence and one primary action', async () => {
    const onAction = jest.fn();
    await render(
      <EmptyState
        icon="list"
        message="Your list is empty."
        actionLabel="Add an item"
        onAction={onAction}
        testID="e"
      />,
    );
    expect(screen.getByText('Your list is empty.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Add an item' }));
    expect(onAction).toHaveBeenCalled();
  });
});

describe('Skeleton', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('appears only after 300 ms of waiting', async () => {
    await render(<Skeleton testID="sk" />);
    expect(screen.queryByTestId('sk')).toBeNull();
    await act(async () => jest.advanceTimersByTime(300));
    expect(screen.getByLabelText('Loading')).toBeBusy();
  });

  it('pulses only when Reduce Motion is off', async () => {
    const reduce = jest.spyOn(reduceMotionModule, 'useReduceMotion');
    const loop = jest.spyOn(Animated, 'loop');

    reduce.mockReturnValue(true);
    const first = await render(<Skeleton delay={0} testID="sk" />);
    expect(loop).not.toHaveBeenCalled();
    await first.unmount();

    reduce.mockReturnValue(false);
    await render(<Skeleton delay={0} testID="sk" />);
    expect(loop).toHaveBeenCalled();

    loop.mockRestore();
    reduce.mockRestore();
  });
});

describe('AllergenNotice', () => {
  it.each(['recipe', 'importReview', 'inline'] as const)(
    'names the allergen and person and always shows the disclaimer (%s)',
    async (variant) => {
      await render(<AllergenNotice allergen="peanuts" person="Mia" variant={variant} testID="a" />);
      expect(screen.getByTestId('a-message')).toHaveTextContent(/peanuts/);
      expect(screen.getByTestId('a-message')).toHaveTextContent(/Mia/);
      expect(screen.getByTestId('a-disclaimer')).toHaveTextContent(/isn't medical advice/);
    },
  );
});

describe('CodeInput', () => {
  it('keeps only digits, up to six', () => {
    expect(sanitizeCode('Code: 123 456')).toBe('123456');
    expect(sanitizeCode('12345678')).toBe('123456');
    expect(sanitizeCode('abc')).toBe('');
  });

  it('accepts a pasted code and reports completion', async () => {
    const onComplete = jest.fn();
    function Code() {
      const [code, setCode] = useState('');
      return (
        <CodeInput
          value={code}
          onChange={setCode}
          onComplete={onComplete}
          accessibilityLabel="Code"
          testID="code"
        />
      );
    }
    await render(<Code />);
    await fireEvent.changeText(screen.getByLabelText('Code'), '123 456');
    expect(onComplete).toHaveBeenCalledWith('123456');
    expect(screen.getByTestId('code-cell-5', { includeHiddenElements: true })).toHaveTextContent(
      '6',
    );
  });

  it('shows errors in text and uses a numeric keyboard', async () => {
    await render(
      <CodeInput
        value="12"
        onChange={jest.fn()}
        accessibilityLabel="Code"
        error="That code didn't work"
        testID="code"
      />,
    );
    expect(screen.getByTestId('code-error')).toHaveTextContent("That code didn't work");
    expect(screen.getByTestId('code').props.keyboardType).toBe('number-pad');
  });
});
