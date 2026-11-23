import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AddDocumentButton, FREE_DOCUMENTS } from '@/features/documents/add-button';
import { resetAddDraft, useAddDraft } from '@/features/documents/add-draft';
import { AddDocumentScreen } from '@/features/documents/add-document-screen';
import { UploadError } from '@/features/documents/upload';

const mockCapture = {
  source: 'scan',
  mime: 'image/jpeg',
  files: [
    { uri: 'file:///cache/1.jpg', size: 10 },
    { uri: 'file:///cache/2.jpg', size: 10 },
  ],
  truncated: false,
};
let mockScanner = true;
const mockPickFile = jest.fn();
const mockDiscard = jest.fn();
jest.mock('@/features/documents/capture', () => ({
  scannerAvailable: () => mockScanner,
  scan: async () => ({ status: 'captured', capture: mockCapture }),
  takePhoto: async () => ({ status: 'denied', canAskAgain: false }),
  pickFile: () => mockPickFile(),
  discardCapture: (...a: unknown[]) => mockDiscard(...a),
}));
const mockAdd = jest.fn();
jest.mock('@/features/documents/add-queue', () => ({
  addDocument: (...a: unknown[]) => mockAdd(...a),
}));
const mockOpenPremiumSheet = jest.fn();
jest.mock('@/features/subscription/premium-sheet', () => ({
  usePremiumSheet: () => ({ openPremiumSheet: mockOpenPremiumSheet }),
}));
let mockPremium = false;
jest.mock('@/features/subscription/entitlement', () => ({
  useEntitlement: () => ({ isPremium: mockPremium }),
}));
let mockRows: Record<string, unknown[]> = {};
jest.mock('@/lib/sync', () => ({
  useSyncedRows: (table: string) => ({ rows: mockRows[table] ?? [], loading: false }),
}));
jest.mock('@/features/people/data', () => ({
  fetchPeople: async () => [{ id: 'p1', displayName: 'Mia', ageBand: 'toddler', allergies: [] }],
}));
jest.mock('@/lib/supabase', () => ({
  getSupabase: () => ({ auth: { signOut: async () => ({ error: null }) } }),
}));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const household = { id: 'hh', locale: 'en-US' as const, timezone: 'America/New_York' };
const onDone = jest.fn();

const show = async (online = true) => {
  const view = await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <AddDocumentScreen household={household} online={online} onDone={onDone} />
    </SafeAreaProvider>,
  );
  await act(async () => undefined);
  return view;
};

async function fill() {
  await fireEvent.press(screen.getByTestId('add-scan'));
  await fireEvent.changeText(screen.getByTestId('add-title'), 'Insurance card');
  await fireEvent.press(screen.getByTestId('add-category-doc.insurance'));
}

const saveDisabled = () =>
  screen.getByTestId('add-save').props.accessibilityState?.disabled === true;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: new Date('2026-11-22T12:00:00Z'), advanceTimers: true });
  mockScanner = true;
  mockPremium = false;
  mockRows = { documents: [] };
  resetAddDraft();
});
afterEach(() => jest.useRealTimers());

describe('S-41 add a document (FR2-DOC-2)', () => {
  it('offers scan only where the scanner exists; photo and file always', async () => {
    mockScanner = false;
    await show();
    expect(screen.queryByTestId('add-scan')).toBeNull();
    expect(screen.getByTestId('add-photo')).toBeTruthy();
    expect(screen.getByTestId('add-file')).toBeTruthy();
  });

  it('needs a file, a title and a category, and stores the person and expiry', async () => {
    mockAdd.mockResolvedValue('added');
    await show();
    expect(saveDisabled()).toBe(true);
    await fill();
    expect(screen.getByText('2 pages')).toBeTruthy();
    expect(saveDisabled()).toBe(false);
    await fireEvent.press(await screen.findByTestId('add-person-p1'));
    await fireEvent(screen.getByTestId('add-expires'), 'valueChange', true);
    expect(screen.getByText('November 22, 2027')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('add-save'));
    expect(mockAdd).toHaveBeenCalledWith({
      householdId: 'hh',
      details: {
        title: 'Insurance card',
        category: 'doc.insurance',
        personId: 'p1',
        expiresOn: '2027-11-22',
      },
      capture: mockCapture,
      online: true,
    });
    expect(onDone).toHaveBeenCalledWith('added');
    // The files were handed to the upload, so they aren't discarded here.
    expect(mockDiscard).not.toHaveBeenCalled();
  });

  it('saves offline as a draft that waits to upload', async () => {
    mockAdd.mockResolvedValue('waiting');
    await show(false);
    expect(screen.getByTestId('add-offline')).toBeTruthy();
    await fill();
    await fireEvent.press(screen.getByTestId('add-save'));
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ online: false }));
    expect(onDone).toHaveBeenCalledWith('waiting');
  });

  it('opens the Premium sheet with the documents trigger at the limit (FR2-DOC-8)', async () => {
    mockAdd.mockRejectedValue(new UploadError('documents.limit'));
    await show();
    await fill();
    await fireEvent.press(screen.getByTestId('add-save'));
    expect(mockOpenPremiumSheet).toHaveBeenCalledWith('documents');
    expect(onDone).not.toHaveBeenCalled();
  });

  it('explains refusals and capture problems', async () => {
    mockAdd.mockRejectedValue(new UploadError('documents.file_too_large'));
    mockPickFile.mockResolvedValue({ status: 'unsupported' });
    await show();
    await fireEvent.press(screen.getByTestId('add-file'));
    expect(screen.getByText('Choose a PDF, JPEG, PNG or HEIC file.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('add-photo'));
    expect(screen.getByText(/Turn on camera access/)).toBeTruthy();
    await fill();
    await fireEvent.press(screen.getByTestId('add-save'));
    expect(screen.getByText('That file is over 10 MB. Choose a smaller one.')).toBeTruthy();
  });

  it('keeps the form if the vault lock unmounts the screen, and discards it on back', async () => {
    const view = await show();
    await fill();
    await act(async () => view.unmount());
    await show();
    expect(screen.getByDisplayValue('Insurance card')).toBeTruthy();
    expect(screen.getByText('2 pages')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('add-document-title-back'));
    expect(onDone).toHaveBeenCalledWith('cancelled');
    expect(mockDiscard).toHaveBeenCalledWith(mockCapture);
  });
});

describe('S-40 add action (FR2-DOC-8)', () => {
  const doc = (id: string) => ({ id, status: 'ready', deleted_at: null, category: 'doc.other' });
  const press = async () => {
    const onAdd = jest.fn();
    await render(<AddDocumentButton onAdd={onAdd} />);
    await fireEvent.press(screen.getByTestId('vault-add'));
    return onAdd;
  };

  it('opens S-41 under the Free limit, and the Premium sheet at it', async () => {
    mockRows.documents = Array.from({ length: FREE_DOCUMENTS - 1 }, (_, i) => doc(`d${i}`));
    expect(await press()).toHaveBeenCalled();

    mockRows.documents = Array.from({ length: FREE_DOCUMENTS }, (_, i) => doc(`d${i}`));
    expect(await press()).not.toHaveBeenCalled();
    expect(mockOpenPremiumSheet).toHaveBeenCalledWith('documents');
  });

  it('leaves the 2 GB limit on Premium to the server', async () => {
    mockPremium = true;
    mockRows.documents = Array.from({ length: 40 }, (_, i) => doc(`d${i}`));
    expect(await press()).toHaveBeenCalled();
  });
});

describe('the add draft', () => {
  it('is empty after a reset', async () => {
    resetAddDraft();
    let seen: unknown = null;
    function Probe() {
      seen = useAddDraft();
      return null;
    }
    await render(<Probe />);
    expect(seen).toEqual({
      capture: null,
      title: '',
      category: null,
      personId: null,
      expiresOn: null,
    });
  });
});
