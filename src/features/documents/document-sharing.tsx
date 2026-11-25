import { randomUUID } from 'expo-crypto';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { CheckboxMark } from '@/components/checkbox';
import { ListRow } from '@/components/list-row';
import { SectionHeader } from '@/components/section-header';
import { Text } from '@/components/text';
import { useCalendarMembers } from '@/features/calendar/use-members';
import type { Member } from '@/features/household/members';
import { useEntitlement } from '@/features/subscription/entitlement';
import { usePremiumSheet } from '@/features/subscription/premium-sheet';
import { useTheme } from '@/hooks/use-theme';
import { formatList, type AppLocale } from '@/i18n';
import { track } from '@/lib/analytics';
import { useSyncedRows, useSyncWriter } from '@/lib/sync';

import { applyShareChanges, liveShares } from './shares';
import { DOCUMENT_SHARES, type DocumentShareRow } from './tables';

/** Family members and caregivers: the only members a document is shared with (D-16). */
export function shareableMembers(members: readonly Member[]): Member[] {
  return members.filter((m) => m.role === 'family' || m.role === 'caregiver');
}

/** The household's live document shares, from the local copy. */
export function useDocumentShares(): DocumentShareRow[] {
  return useSyncedRows<DocumentShareRow>(DOCUMENT_SHARES.name).rows;
}

/**
 * S-42's sharing, for parents (FR2-DOC-6, spec section 2, V4): who the document is shared
 * with, and a share action that picks named family members and caregivers. Sharing is
 * Premium: on Free the action opens the Premium sheet (`document_share`, FR2-PAY-1).
 */
export function DocumentSharing({
  documentId,
  householdId,
  locale,
}: {
  documentId: string;
  householdId: string;
  locale: AppLocale;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { isPremium } = useEntitlement();
  const { openPremiumSheet } = usePremiumSheet();
  const members = shareableMembers(useCalendarMembers(householdId));
  const shares = useDocumentShares();
  const writer = useSyncWriter();
  const [open, setOpen] = useState(false);
  const [changes, setChanges] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [saving, setSaving] = useState(false);
  const live = liveShares(shares, documentId);
  const ticked = (userId: string) => changes.get(userId) ?? live.has(userId);
  const nameOf = (userId: string) =>
    members.find((m) => m.userId === userId)?.displayName ?? t('documents.share.member');
  const sharedWith = [...live.keys()].map(nameOf);

  const start = () => {
    if (!isPremium) {
      openPremiumSheet('document_share');
      return;
    }
    setChanges(new Map());
    setOpen(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const result = await applyShareChanges(writer, documentId, shares, changes, randomUUID);
      // Counts and fixed values only (FR2-DOC-11).
      if (result.shared > 0)
        track('document_shared', { shared: true, members_count: result.shared });
      if (result.unshared > 0)
        track('document_shared', { shared: false, members_count: result.unshared });
      setOpen(false);
    } catch {
      Alert.alert(t('documents.share.failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ gap: theme.space[2] }} testID="document-sharing">
      <SectionHeader title={t('documents.share.title')} variant="group" />
      <Text color="textSecondary" testID="document-shared-with">
        {sharedWith.length > 0
          ? t('documents.share.with', { names: formatList(sharedWith, locale) })
          : t('documents.share.nobody')}
      </Text>
      <Button
        variant="secondary"
        icon="people"
        label={t('documents.share.action')}
        onPress={start}
        fullWidth
        testID="document-share"
      />
      <BottomSheet
        visible={open}
        onClose={() => setOpen(false)}
        title={t('documents.share.sheetTitle')}
        footer={
          members.length > 0 ? (
            <Button
              label={t('documents.share.save')}
              onPress={save}
              loading={saving}
              disabled={changes.size === 0}
              fullWidth
              testID="document-share-save"
            />
          ) : undefined
        }
        testID="document-share-sheet"
      >
        {members.length === 0 ? (
          <Text color="textSecondary" testID="document-share-no-members">
            {t('documents.share.noMembers')}
          </Text>
        ) : (
          <View>
            {members.map((member, index) => (
              <ListRow
                key={member.userId}
                title={member.displayName ?? t('documents.share.member')}
                subtitle={t(`documents.share.role.${member.role}`)}
                leading={<CheckboxMark checked={ticked(member.userId)} />}
                onPress={() =>
                  setChanges((current) =>
                    new Map(current).set(member.userId, !ticked(member.userId)),
                  )
                }
                divider={index < members.length - 1}
                testID={`document-share-member-${member.userId}`}
              />
            ))}
          </View>
        )}
      </BottomSheet>
    </View>
  );
}
