import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DocumentScreen } from '@/features/documents/document-screen';
import {
  clearPendingUploads,
  putPendingUpload,
  setPendingState,
} from '@/features/documents/pending-uploads';
import type { DocumentRow } from '@/features/documents/tables';
import { categoryKey, isExpired, vaultSections } from '@/features/documents/vault-list';
import { VaultScreen } from '@/features/documents/vault-screen';
import { validateEvent } from '@/lib/analytics/schema';

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

const doc = (over: Partial<DocumentRow> = {}): DocumentRow => ({
  id: 'd1',
  household_id: 'hh',
  version: 1,
  created_at: null,
  updated_at: null,
  deleted_at: null,
  title: 'Insurance card',
  category: 'doc.insurance',
  person_id: null,
  expires_on: null,
  mime: 'image/jpeg',
  page_count: 2,
  size_bytes: 1000,
  status: 'ready',
  created_by: 'parent',
  ...over,
});

const onOpen = jest.fn();
const showVault = async (online = true) => {
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <VaultScreen household={household} online={online} onBack={jest.fn()} onOpen={onOpen} />
    </SafeAreaProvider>,
  );
  await act(async () => undefined);
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: new Date('2026-11-22T12:00:00Z'), advanceTimers: true });
  clearPendingUploads();
  mockRows = { documents: [] };
});
afterEach(() => jest.useRealTimers());

describe('vault list (FR2-DOC-1)', () => {
  it('groups by category in the fixed order, titles sorted within each', () => {
    const sections = vaultSections(
      [
        doc({ id: 'a', title: 'Passport', category: 'doc.identity' }),
        doc({ id: 'b', title: 'Vaccinations', category: 'doc.medical' }),
        doc({ id: 'c', title: 'insurance 10', category: 'doc.insurance' }),
        doc({ id: 'd', title: 'Insurance 9', category: 'doc.insurance' }),
      ],
      'en-US',
    );
    expect(sections.map((s) => s.category)).toEqual([
      'doc.insurance',
      'doc.identity',
      'doc.medical',
    ]);
    expect(sections[0].documents.map((d) => d.id)).toEqual(['d', 'c']);
    expect(categoryKey('doc.childcare_school')).toBe('documents.category.childcare_school');
  });

  it('counts a document as expired only after its expiry day', () => {
    expect(isExpired('2026-11-21', '2026-11-22')).toBe(true);
    expect(isExpired('2026-11-22', '2026-11-22')).toBe(false);
    expect(isExpired(null, '2026-11-22')).toBe(false);
  });

  it('lists ready documents with person and expiry, from the local copy', async () => {
    mockRows.documents = [
      doc({ person_id: 'p1', expires_on: '2027-03-01' }),
      doc({ id: 'd2', title: 'Old passport', category: 'doc.identity', expires_on: '2026-01-05' }),
      doc({ id: 'd3', title: 'Deleted', deleted_at: '2026-11-01T00:00:00Z' }),
      doc({ id: 'd4', title: 'Half uploaded', status: 'uploading' }),
    ];
    await showVault();
    const insurance = within(screen.getByTestId('vault-section-doc.insurance'));
    expect(insurance.getByText('Insurance')).toBeTruthy();
    expect(insurance.getByText('Insurance card')).toBeTruthy();
    expect(await screen.findByText('Mia · Expires Mar 1, 2027')).toBeTruthy();
    expect(screen.getByText('Expired Jan 5, 2026')).toBeTruthy();
    expect(screen.queryByText('Deleted')).toBeNull();
    expect(screen.queryByText('Half uploaded')).toBeNull();
    expect(screen.queryByTestId('vault-empty')).toBeNull();

    fireEvent.press(screen.getByTestId('document-row-d2'));
    expect(onOpen).toHaveBeenCalledWith('d2');
  });

  it('works offline as a list, saying files need a connection (NFR2-OFF-1)', async () => {
    mockRows.documents = [doc()];
    await showVault(false);
    expect(screen.getByTestId('vault-offline')).toBeTruthy();
    expect(screen.getByText('Insurance card')).toBeTruthy();
    fireEvent.press(screen.getByTestId('document-row-d1'));
    expect(onOpen).toHaveBeenCalledWith('d1');
  });

  it('shows documents added on this device as waiting to upload', async () => {
    putPendingUpload({
      id: 'new',
      householdId: 'hh',
      title: 'School form',
      category: 'doc.childcare_school',
      personId: null,
      expiresOn: null,
      state: 'waiting',
    });
    putPendingUpload({
      id: 'other',
      householdId: 'other-household',
      title: 'Not ours',
      category: 'doc.other',
      personId: null,
      expiresOn: null,
      state: 'waiting',
    });
    await showVault(false);
    const pending = within(screen.getByTestId('vault-pending'));
    expect(pending.getByText('Waiting to upload')).toBeTruthy();
    expect(pending.getByText('School form')).toBeTruthy();
    expect(pending.getByText('Waiting for a connection')).toBeTruthy();
    expect(screen.queryByText('Not ours')).toBeNull();

    await act(async () => setPendingState('new', 'failed'));
    expect(screen.getByText("Couldn't upload. We'll try again.")).toBeTruthy();
  });

  it('shows the empty state with nothing stored or waiting', async () => {
    await showVault();
    expect(screen.getByTestId('vault-empty')).toBeTruthy();
  });
});

describe('document details (S-42)', () => {
  const showDocument = async (online: boolean, id = 'd1') => {
    await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <DocumentScreen documentId={id} household={household} online={online} onBack={jest.fn()} />
      </SafeAreaProvider>,
    );
    await act(async () => undefined);
  };

  it('shows the details offline, with the offline message instead of the file', async () => {
    mockRows.documents = [doc({ person_id: 'p1', expires_on: '2027-03-01' })];
    await showDocument(false);
    expect(screen.getByTestId('document-offline-message')).toBeTruthy();
    expect(
      screen.getByText("You're offline. Connect to the internet to open this document."),
    ).toBeTruthy();
    expect(screen.getByText('March 1, 2027')).toBeTruthy();
    expect(await screen.findByText('Mia')).toBeTruthy();
  });

  it("says when the document is gone or isn't shared any more", async () => {
    await showDocument(true, 'missing');
    expect(screen.getByTestId('document-gone')).toBeTruthy();
  });
});

describe('vault analytics (FR2-DOC-11)', () => {
  it('records how the vault was opened, and nothing about any document', () => {
    expect(validateEvent('vault_opened', { unlocked_with: 'biometric' })).toEqual({
      unlocked_with: 'biometric',
    });
    expect(() =>
      validateEvent('vault_opened', { unlocked_with: 'biometric', category: 'doc.medical' }),
    ).toThrow();
    expect(() => validateEvent('vault_opened', { unlocked_with: 'Insurance card' })).toThrow();
  });
});
