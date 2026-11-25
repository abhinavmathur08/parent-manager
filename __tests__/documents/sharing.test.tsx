import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DocumentSharing, shareableMembers } from '@/features/documents/document-sharing';
import { useShareAttachmentsOffer } from '@/features/documents/share-attachments-offer';
import { applyShareChanges, shareDocuments } from '@/features/documents/shares';
import type { DocumentRow, DocumentShareRow } from '@/features/documents/tables';
import { validateEvent } from '@/lib/analytics/schema';

let mockRows: Record<string, unknown[]> = {};
const mockInsert = jest.fn(async (..._args: unknown[]) => ({}));
const mockRemove = jest.fn(async (..._args: unknown[]) => ({}));
jest.mock('@/lib/sync', () => ({
  useSyncedRows: (table: string) => ({ rows: mockRows[table] ?? [], loading: false }),
  useSyncWriter: () => ({ insert: mockInsert, update: jest.fn(), remove: mockRemove }),
}));
let mockPremium = true;
jest.mock('@/features/subscription/entitlement', () => ({
  useEntitlement: () => ({ isPremium: mockPremium }),
}));
const mockOpenPremiumSheet = jest.fn();
jest.mock('@/features/subscription/premium-sheet', () => ({
  usePremiumSheet: () => ({ openPremiumSheet: mockOpenPremiumSheet }),
}));
let mockMembers: unknown[] = [];
jest.mock('@/features/household/members', () => ({ fetchMembers: async () => mockMembers }));
let mockUuid = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `share-${++mockUuid}` }));
const mockTrack = jest.fn();
jest.mock('@/lib/analytics', () => ({ track: (...a: unknown[]) => mockTrack(...a) }));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const base = {
  household_id: 'hh',
  version: 1,
  created_at: null,
  updated_at: null,
  deleted_at: null,
};
const share = (
  id: string,
  documentId: string,
  userId: string,
  deleted = false,
): DocumentShareRow => ({
  ...base,
  id,
  document_id: documentId,
  user_id: userId,
  shared_by: 'parent',
  deleted_at: deleted ? '2026-11-22T00:00:00Z' : null,
});
const doc = (id: string, title: string): DocumentRow => ({
  ...base,
  id,
  title,
  category: 'doc.insurance',
  person_id: null,
  expires_on: null,
  mime: 'image/jpeg',
  page_count: 1,
  size_bytes: 1000,
  status: 'ready',
  created_by: 'parent',
});
const MEMBERS = [
  { userId: 'parent', role: 'parent', joinedAt: '', displayName: 'Sam' },
  { userId: 'gran', role: 'family', joinedAt: '', displayName: 'Gran' },
  { userId: 'jo', role: 'caregiver', joinedAt: '', displayName: 'Jo' },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockUuid = 0;
  mockPremium = true;
  mockMembers = MEMBERS;
  mockRows = {};
});

describe('share writes (FR2-DOC-6)', () => {
  const writer = { insert: mockInsert, remove: mockRemove };
  const newId = () => `share-${++mockUuid}`;

  it('shares with family members and caregivers only', () => {
    expect(shareableMembers(MEMBERS as never).map((m) => m.userId)).toEqual(['gran', 'jo']);
  });

  it('writes only the members the parent changed', async () => {
    const shares = [
      share('s1', 'd1', 'gran'),
      share('s2', 'd1', 'jo', true),
      share('s3', 'd2', 'jo'),
    ];
    const result = await applyShareChanges(
      writer,
      'd1',
      shares,
      new Map([
        ['gran', false],
        ['jo', true],
      ]),
      newId,
    );
    expect(result).toEqual({ shared: 1, unshared: 1 });
    expect(mockRemove).toHaveBeenCalledWith('document_shares', 's1');
    expect(mockInsert).toHaveBeenCalledWith('document_shares', 'share-1', {
      document_id: 'd1',
      user_id: 'jo',
      shared_by: null,
    });
  });

  it('shares attachments with everyone, skipping shares that exist', async () => {
    const added = await shareDocuments(
      writer,
      ['d1', 'd2'],
      ['gran', 'jo'],
      [share('s1', 'd1', 'gran')],
      newId,
    );
    expect(added).toBe(3);
    expect(mockInsert).toHaveBeenCalledTimes(3);
  });
});

describe('S-42 sharing', () => {
  const show = async () => {
    await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <DocumentSharing documentId="d1" householdId="hh" locale="en-US" />
      </SafeAreaProvider>,
    );
    await act(async () => undefined);
  };

  it('names who it is shared with', async () => {
    mockRows = { document_shares: [share('s1', 'd1', 'jo'), share('s2', 'd2', 'gran')] };
    await show();
    expect(screen.getByTestId('document-shared-with')).toHaveTextContent('Parents and Jo');
  });

  it('opens the Premium sheet on Free instead of sharing', async () => {
    mockPremium = false;
    await show();
    await fireEvent.press(screen.getByTestId('document-share'));
    expect(mockOpenPremiumSheet).toHaveBeenCalledWith('document_share');
    expect(screen.queryByTestId('document-share-member-jo')).toBeNull();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('shares with a ticked member and records counts only', async () => {
    mockRows = { document_shares: [share('s1', 'd1', 'gran')] };
    await show();
    await fireEvent.press(screen.getByTestId('document-share'));
    expect(screen.queryByTestId('document-share-member-parent')).toBeNull();
    await fireEvent.press(screen.getByTestId('document-share-member-jo'));
    await fireEvent.press(screen.getByTestId('document-share-member-gran'));
    await fireEvent.press(screen.getByTestId('document-share-save'));
    await act(async () => undefined);
    expect(mockInsert).toHaveBeenCalledWith('document_shares', 'share-1', {
      document_id: 'd1',
      user_id: 'jo',
      shared_by: null,
    });
    expect(mockRemove).toHaveBeenCalledWith('document_shares', 's1');
    expect(mockTrack).toHaveBeenCalledWith('document_shared', { shared: true, members_count: 1 });
    expect(mockTrack).toHaveBeenCalledWith('document_shared', { shared: false, members_count: 1 });
    expect(() =>
      validateEvent('document_shared', { shared: true, members_count: 1 }),
    ).not.toThrow();
  });

  it('asks for an invite when there is nobody to share with', async () => {
    mockMembers = [MEMBERS[0]];
    await show();
    await fireEvent.press(screen.getByTestId('document-share'));
    expect(screen.getByTestId('document-share-no-members')).toBeTruthy();
  });
});

describe('share the attachments too (FR2-DOC-6)', () => {
  function Harness() {
    const { offer, sheet } = useShareAttachmentsOffer({
      eventId: 'e1',
      householdId: 'hh',
      locale: 'en-US',
    });
    return (
      <>
        <Text testID="offer" onPress={offer}>
          offer
        </Text>
        {sheet}
      </>
    );
  }
  const show = async () => {
    await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <Harness />
      </SafeAreaProvider>,
    );
    await act(async () => undefined);
  };
  const attached = () => {
    mockRows = {
      documents: [doc('d1', 'Insurance card'), doc('d2', 'Passport')],
      event_documents: [
        { ...base, id: 'l1', event_id: 'e1', document_id: 'd1' },
        { ...base, id: 'l2', event_id: 'e1', document_id: 'd2' },
      ],
    };
  };

  it('offers the attachments unticked, and shares the ticked ones with everyone', async () => {
    attached();
    await show();
    await fireEvent.press(screen.getByTestId('offer'));
    expect(screen.getByTestId('share-attachments-confirm')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('share-attachment-d1'));
    await fireEvent.press(screen.getByTestId('share-attachments-confirm'));
    await act(async () => undefined);
    expect(mockInsert).toHaveBeenCalledTimes(2);
    expect(mockInsert.mock.calls.map((c) => (c[2] as { user_id: string }).user_id)).toEqual([
      'gran',
      'jo',
    ]);
    expect(
      mockInsert.mock.calls.every((c) => (c[2] as { document_id: string }).document_id === 'd1'),
    ).toBe(true);
  });

  it('offers nothing on Free', async () => {
    attached();
    mockPremium = false;
    await show();
    await fireEvent.press(screen.getByTestId('offer'));
    expect(screen.queryByTestId('share-attachment-d1')).toBeNull();
  });
});
