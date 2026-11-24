import { randomUUID } from 'expo-crypto';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { CheckboxMark } from '@/components/checkbox';
import { ListRow } from '@/components/list-row';
import { Text } from '@/components/text';
import { useCalendarMembers } from '@/features/calendar/use-members';
import { useEntitlement } from '@/features/subscription/entitlement';
import { useTheme } from '@/hooks/use-theme';
import { track } from '@/lib/analytics';
import { useSyncWriter } from '@/lib/sync';

import { useEventAttachments } from './attachments';
import { shareableMembers, useDocumentShares } from './document-sharing';
import { shareDocuments } from './shares';

/**
 * "Share the attachments too?" when a parent shares an event that has attachments
 * (FR2-DOC-6): each document unticked by default (PROPOSED), shared with every family member
 * and caregiver, who see the event once it's shared. Only on Premium, since sharing documents
 * is Premium, and only when the household has someone to share with.
 */
export function useShareAttachmentsOffer({
  eventId,
  householdId,
  locale,
}: {
  eventId: string;
  householdId: string;
  locale: string;
}): { offer: () => void; sheet: ReactNode } {
  const { t } = useTranslation();
  const theme = useTheme();
  const { isPremium } = useEntitlement();
  const documents = useEventAttachments(eventId, locale);
  const members = shareableMembers(useCalendarMembers(householdId));
  const shares = useDocumentShares();
  const writer = useSyncWriter();
  const [open, setOpen] = useState(false);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const offer = () => {
    if (!isPremium || documents.length === 0 || members.length === 0) return;
    setTicked(new Set());
    setOpen(true);
  };

  const toggle = (id: string) =>
    setTicked((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const share = async () => {
    setSaving(true);
    try {
      const userIds = members.map((m) => m.userId);
      const added = await shareDocuments(writer, [...ticked], userIds, shares, randomUUID);
      if (added > 0) track('document_shared', { shared: true, members_count: userIds.length });
      setOpen(false);
    } catch {
      Alert.alert(t('documents.share.failed'));
    } finally {
      setSaving(false);
    }
  };

  const sheet = (
    <BottomSheet
      visible={open}
      onClose={() => setOpen(false)}
      title={t('documents.shareAttachments.title')}
      footer={
        <View style={{ gap: theme.space[2] }}>
          <Button
            label={t('documents.shareAttachments.share')}
            onPress={share}
            loading={saving}
            disabled={ticked.size === 0}
            fullWidth
            testID="share-attachments-confirm"
          />
          <Button
            variant="secondary"
            label={t('documents.shareAttachments.notNow')}
            onPress={() => setOpen(false)}
            fullWidth
            testID="share-attachments-skip"
          />
        </View>
      }
      testID="share-attachments"
    >
      <View style={{ gap: theme.space[2] }}>
        <Text color="textSecondary">{t('documents.shareAttachments.body')}</Text>
        <View>
          {documents.map((doc, index) => (
            <ListRow
              key={doc.id}
              title={doc.title}
              leading={<CheckboxMark checked={ticked.has(doc.id)} />}
              onPress={() => toggle(doc.id)}
              divider={index < documents.length - 1}
              testID={`share-attachment-${doc.id}`}
            />
          ))}
        </View>
      </View>
    </BottomSheet>
  );

  return { offer, sheet };
}
