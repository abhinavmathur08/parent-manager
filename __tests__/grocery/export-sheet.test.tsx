import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Linking, Platform, Share } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ExportSheet } from '@/features/grocery/export/export-sheet';
import type { ListRowView, ListView } from '@/features/grocery/view';

const mockTrack = jest.fn();
jest.mock('@/lib/analytics', () => ({ track: (...args: unknown[]) => mockTrack(...args) }));
const mockPrint = jest.fn(async (_options: { html: string }) => undefined);
const mockToFile = jest.fn(async (_options: { html: string }) => ({ uri: 'file:///list.pdf' }));
jest.mock('expo-print', () => ({
  printAsync: (options: { html: string }) => mockPrint(options),
  printToFileAsync: (options: { html: string }) => mockToFile(options),
}));
const mockShareFile = jest.fn(async (_uri: string, _options: unknown) => undefined);
jest.mock('expo-sharing', () => ({
  shareAsync: (uri: string, options: unknown) => mockShareFile(uri, options),
}));

const mockCopy = jest.fn(async (_text: string) => true);
jest.mock('expo-clipboard', () => ({ setStringAsync: (text: string) => mockCopy(text) }));

const mockExportToReminders = jest.fn();
jest.mock('@/features/grocery/export/reminders', () => ({
  exportToReminders: (...args: unknown[]) => mockExportToReminders(...args),
}));
const mockOpenSettings = jest.fn(async () => undefined);

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const row = (id: string, over: Partial<ListRowView> = {}): ListRowView => ({
  id,
  name: id,
  quantity: [{ value: 2, unitId: 'unit.each' }],
  meals: 0,
  origin: 'plan',
  planChanged: false,
  checked: false,
  sectionId: 'section.produce',
  allergens: [],
  ...over,
});
const view: ListView = {
  sections: [{ sectionId: 'section.produce', rows: [row('onions'), row('carrots')] }],
  cart: [row('apples', { checked: true })],
  total: 3,
};

const show = async (listView: ListView = view) => {
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ExportSheet
        visible
        onClose={() => undefined}
        view={listView}
        weekStart="2026-11-15"
        locale="en-US"
        householdId="hh"
      />
    </SafeAreaProvider>,
  );
  await act(async () => undefined);
};

beforeEach(() => {
  mockTrack.mockClear();
  mockPrint.mockClear();
  mockToFile.mockClear();
  mockShareFile.mockClear();
  mockExportToReminders.mockReset();
  mockCopy.mockClear();
});

describe('S-23 export sheet (FR-EXP-1, FR-EXP-2)', () => {
  it('prints unchecked items, and analytics get only counts', async () => {
    await show();
    await fireEvent.press(screen.getByTestId('export-print'));
    await act(async () => undefined);
    const html = mockPrint.mock.calls[0]?.[0].html ?? '';
    expect(html).toContain('2 onions');
    expect(html).not.toContain('apples');
    expect(mockTrack).toHaveBeenCalledWith('list_exported', {
      target: 'print',
      item_count: 2,
      included_checked: false,
    });
    expect(JSON.stringify(mockTrack.mock.calls)).not.toMatch(/onions|carrots/);
  });

  it('includes checked items when asked', async () => {
    await show();
    await fireEvent(screen.getByTestId('export-include-checked'), 'press');
    expect(screen.getByTestId('export-count')).toHaveTextContent('3 items');
    await fireEvent.press(screen.getByTestId('export-print'));
    await act(async () => undefined);
    expect(mockPrint.mock.calls[0]?.[0].html).toContain('apples');
    expect(mockTrack).toHaveBeenCalledWith('list_exported', {
      target: 'print',
      item_count: 3,
      included_checked: true,
    });
  });

  it('saves a PDF on the device and opens the share sheet', async () => {
    await show();
    await fireEvent.press(screen.getByTestId('export-pdf'));
    await act(async () => undefined);
    expect(mockToFile.mock.calls[0]?.[0].html).toContain('<h1>Groceries</h1>');
    expect(mockShareFile).toHaveBeenCalledWith(
      'file:///list.pdf',
      expect.objectContaining({ mimeType: 'application/pdf' }),
    );
  });

  it('reports a failure with a fixed code and tells the member', async () => {
    mockToFile.mockRejectedValueOnce(
      Object.assign(new Error('disk full: /path'), { code: 'ERR_PRINT' }),
    );
    await show();
    await fireEvent.press(screen.getByTestId('export-pdf'));
    await act(async () => undefined);
    expect(mockTrack).toHaveBeenCalledWith('list_export_failed', {
      target: 'pdf',
      error_code: 'err_print',
    });
    expect(screen.getByTestId('export-failed')).toHaveTextContent(
      "That didn't work. Try again, or use another option.",
    );
  });

  it('stays quiet when the iOS print dialog is closed without printing', async () => {
    const os = Platform.OS;
    Platform.OS = 'ios';
    mockPrint.mockRejectedValueOnce(new Error('Printing did not complete'));
    await show();
    await fireEvent.press(screen.getByTestId('export-print'));
    await act(async () => undefined);
    expect(screen.queryByTestId('export-failed')).toBeNull();
    Platform.OS = os;
  });

  it('explains why nothing can be exported when everything is checked', async () => {
    await show({ sections: [], cart: view.cart, total: 1 });
    expect(screen.getByTestId('export-empty')).toHaveTextContent(/Everything is checked off/);
    expect(screen.getByTestId('export-pdf')).toBeDisabled();
    await fireEvent(screen.getByTestId('export-include-checked'), 'press');
    expect(screen.getByTestId('export-pdf')).not.toBeDisabled();
  });
});

describe('S-23 share and copy as text (FR-EXP-4)', () => {
  it('opens the share sheet with the checklist text', async () => {
    const share = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: Share.sharedAction, activityType: undefined });
    await show();
    await fireEvent.press(screen.getByTestId('export-share'));
    await act(async () => undefined);
    expect(share.mock.calls[0]?.[0]).toEqual({
      title: 'Groceries',
      message: 'Groceries, Nov 15 – Nov 21\n\nProduce\n☐ 2 onions\n☐ 2 carrots',
    });
    expect(mockTrack).toHaveBeenCalledWith('list_exported', {
      target: 'share_text',
      item_count: 2,
      included_checked: false,
    });
  });

  it('counts nothing when the share sheet is closed without sharing', async () => {
    jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: Share.dismissedAction, activityType: undefined });
    await show();
    await fireEvent.press(screen.getByTestId('export-share'));
    await act(async () => undefined);
    expect(mockTrack).not.toHaveBeenCalled();
    expect(screen.queryByTestId('export-failed')).toBeNull();
  });

  it('copies the same text and confirms it', async () => {
    await show();
    expect(screen.queryByTestId('export-copied')).toBeNull();
    await fireEvent.press(screen.getByTestId('export-copy'));
    await act(async () => undefined);
    expect(mockCopy).toHaveBeenCalledWith(
      'Groceries, Nov 15 – Nov 21\n\nProduce\n☐ 2 onions\n☐ 2 carrots',
    );
    expect(screen.getByTestId('export-copied')).toHaveTextContent(/Copied/);
    expect(mockTrack).toHaveBeenCalledWith('list_exported', {
      target: 'copy_text',
      item_count: 2,
      included_checked: false,
    });
  });
});

describe('S-23 Apple Reminders (FR-EXP-3, FR-EXP-5)', () => {
  const os = Platform.OS;
  beforeEach(() => {
    Platform.OS = 'ios';
    jest.spyOn(Linking, 'openSettings').mockImplementation(mockOpenSettings);
  });
  afterEach(() => {
    Platform.OS = os;
  });

  it('is offered on iOS only', async () => {
    Platform.OS = 'android';
    await show();
    expect(screen.queryByTestId('export-reminders')).toBeNull();
  });

  it('exports the same document to the week list and confirms', async () => {
    mockExportToReminders.mockResolvedValue(undefined);
    await show();
    await fireEvent.press(screen.getByTestId('export-reminders'));
    await act(async () => undefined);
    const [householdId, doc, title] = mockExportToReminders.mock.calls[0] ?? [];
    expect(householdId).toBe('hh');
    expect(doc).toMatchObject({ weekStart: '2026-11-15', itemCount: 2 });
    expect(title).toBe('Groceries, Nov 15 – Nov 21');
    expect(screen.getByTestId('export-reminders-done')).toHaveTextContent(/2 items/);
    expect(mockTrack).toHaveBeenCalledWith('list_exported', {
      target: 'apple_reminders',
      item_count: 2,
      included_checked: false,
    });
  });

  it('explains how to turn Reminders on and keeps Share and Copy there when refused', async () => {
    mockExportToReminders.mockRejectedValue(
      Object.assign(new Error(), { code: 'reminders_denied' }),
    );
    await show();
    await fireEvent.press(screen.getByTestId('export-reminders'));
    await act(async () => undefined);
    expect(screen.getByTestId('export-reminders-denied')).toHaveTextContent(/open Settings/);
    expect(screen.getByTestId('export-share')).not.toBeDisabled();
    expect(screen.getByTestId('export-copy')).not.toBeDisabled();
    expect(screen.queryByTestId('export-failed')).toBeNull();
    await fireEvent.press(screen.getByTestId('export-open-settings'));
    expect(mockOpenSettings).toHaveBeenCalled();
  });
});
