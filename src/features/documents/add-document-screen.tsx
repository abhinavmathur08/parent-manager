import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Banner } from '@/components/banner';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { Screen } from '@/components/screen';
import { Stepper } from '@/components/stepper';
import { Switch } from '@/components/switch';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { usePlanPeople } from '@/features/planner/use-plan-people';
import { addDays, daysBetween, todayIn, toDate } from '@/features/planner/week';
import { usePremiumSheet } from '@/features/subscription/premium-sheet';
import { useTheme } from '@/hooks/use-theme';
import { formatDate, formatNumber } from '@/i18n';

import { addDocument } from './add-queue';
import { canSaveDraft, resetAddDraft, updateAddDraft, useAddDraft } from './add-draft';
import {
  discardCapture,
  pickFile,
  scan,
  scannerAvailable,
  takePhoto,
  type CaptureOutcome,
} from './capture';
import { DOCUMENT_CATEGORIES, DOCUMENT_LIMITS } from './tables';
import { UploadError } from './upload';
import { categoryKey } from './vault-list';
import type { VaultHousehold } from './vault-screen';

export type AddDocumentScreenProps = {
  household: VaultHousehold;
  online: boolean;
  /** Leaves S-41: `added` when stored, `waiting` when it'll upload later, or `cancelled`. */
  onDone: (result: 'added' | 'waiting' | 'cancelled') => void;
  /** Runs once the document is stored, even after S-41 has closed (FR2-DOC-5). */
  afterAdded?: (documentId: string) => Promise<void>;
};

const DATE_FORMAT = { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' } as const;
const CAPTURE_ERRORS: Partial<Record<CaptureOutcome['status'], string>> = {
  denied: 'documents.add.errors.camera',
  too_large: 'documents.add.errors.file_too_large',
  unsupported: 'documents.add.errors.unsupported',
  failed: 'documents.add.errors.capture',
};

/**
 * S-41 Add document (FR2-DOC-2): scan (where the device has the system scanner), take a
 * photo or choose a PDF or image, then a title and category (required), and a person and
 * expiry date (optional). At the limit the Premium sheet opens (FR2-DOC-8). Nothing in the
 * file is read (FR2-DOC-11). Parents only; render it inside `VaultGate`.
 */
export function AddDocumentScreen({
  household,
  online,
  onDone,
  afterAdded,
}: AddDocumentScreenProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const draft = useAddDraft();
  const people = usePlanPeople(household.id).people;
  const { openPremiumSheet } = usePremiumSheet();
  const [busy, setBusy] = useState<'capture' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const today = todayIn(household.timezone);
  const { capture } = draft;

  const take = async (how: () => Promise<CaptureOutcome>) => {
    setError(null);
    setBusy('capture');
    try {
      const outcome = await how();
      if (outcome.status === 'captured') updateAddDraft({ capture: outcome.capture });
      else if (CAPTURE_ERRORS[outcome.status]) setError(t(CAPTURE_ERRORS[outcome.status]!));
    } catch {
      setError(t('documents.add.errors.capture'));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!canSaveDraft(draft) || !draft.capture || !draft.category) return;
    setError(null);
    setBusy('save');
    try {
      const result = await addDocument({
        householdId: household.id,
        details: {
          title: draft.title,
          category: draft.category,
          personId: draft.personId,
          expiresOn: draft.expiresOn,
        },
        capture: draft.capture,
        online,
        afterAdded,
      });
      resetAddDraft({ keepFiles: true });
      onDone(result);
    } catch (thrown) {
      const code = thrown instanceof UploadError ? thrown.code : 'documents.failed';
      if (code === 'documents.limit') openPremiumSheet('documents');
      else setError(t(`documents.add.errors.${code.slice('documents.'.length)}`));
    } finally {
      setBusy(null);
    }
  };

  const cancel = () => {
    resetAddDraft();
    onDone('cancelled');
  };

  const captureSummary = capture
    ? capture.mime === 'application/pdf'
      ? t('documents.add.pdf')
      : t('documents.add.pages', {
          count: capture.files.length,
          formatted: formatNumber(capture.files.length, household.locale),
        })
    : null;

  return (
    <Screen
      title={t('documents.add.screenTitle')}
      onBack={cancel}
      banner={
        online ? null : (
          <Banner variant="offline" message={t('documents.add.offline')} testID="add-offline" />
        )
      }
      testID="add-document"
    >
      {capture ? (
        <Card testID="add-captured">
          <View style={{ gap: theme.space[2] }}>
            <Text variant="bodyStrong">{captureSummary}</Text>
            {capture.truncated ? (
              <Text color="textSecondary">
                {t('documents.add.truncated', { count: DOCUMENT_LIMITS.pages })}
              </Text>
            ) : null}
            <Button
              label={t('documents.add.replace')}
              variant="ghost"
              onPress={() => {
                discardCapture(capture);
                updateAddDraft({ capture: null });
              }}
              testID="add-replace"
            />
          </View>
        </Card>
      ) : (
        <View style={{ gap: theme.space[2] }} testID="add-sources">
          {scannerAvailable() ? (
            <Button
              label={t('documents.add.scan')}
              icon="camera"
              onPress={() => take(scan)}
              loading={busy === 'capture'}
              fullWidth
              testID="add-scan"
            />
          ) : null}
          <Button
            label={t('documents.add.photo')}
            icon="camera"
            variant="secondary"
            onPress={() => take(takePhoto)}
            disabled={busy !== null}
            fullWidth
            testID="add-photo"
          />
          <Button
            label={t('documents.add.file')}
            icon="document"
            variant="secondary"
            onPress={() => take(pickFile)}
            disabled={busy !== null}
            fullWidth
            testID="add-file"
          />
        </View>
      )}

      <TextField
        label={t('documents.add.title')}
        hint={t('documents.add.titleHint')}
        value={draft.title}
        onChangeText={(title) => updateAddDraft({ title })}
        maxLength={DOCUMENT_LIMITS.titleLength}
        returnKeyType="done"
        testID="add-title"
      />

      <Group label={t('documents.add.category')}>
        {DOCUMENT_CATEGORIES.map((category) => (
          <Chip
            key={category}
            label={t(categoryKey(category))}
            selected={draft.category === category}
            onPress={() => updateAddDraft({ category })}
            testID={`add-category-${category}`}
          />
        ))}
      </Group>

      {people.length > 0 ? (
        <Group label={t('documents.add.person')}>
          {people.map((person) => (
            <Chip
              key={person.id}
              label={person.displayName}
              selected={draft.personId === person.id}
              onPress={() =>
                updateAddDraft({ personId: draft.personId === person.id ? null : person.id })
              }
              testID={`add-person-${person.id}`}
            />
          ))}
        </Group>
      ) : null}

      <Switch
        label={t('documents.add.expires')}
        value={draft.expiresOn !== null}
        onValueChange={(on) => updateAddDraft({ expiresOn: on ? addDays(today, 365) : null })}
        testID="add-expires"
      />
      {draft.expiresOn ? (
        <Stepper
          accessibilityLabel={t('documents.add.expiryDate')}
          value={daysBetween(today, draft.expiresOn)}
          min={-3650}
          onChange={(n) => updateAddDraft({ expiresOn: addDays(today, n) })}
          formatValue={(n) => formatDate(toDate(addDays(today, n)), household.locale, DATE_FORMAT)}
          testID="add-expiry-date"
        />
      ) : null}

      {error ? (
        <Text color="error" accessibilityRole="alert" testID="add-error">
          {error}
        </Text>
      ) : null}
      <Button
        label={t('documents.add.save')}
        onPress={save}
        disabled={!canSaveDraft(draft) || busy === 'capture'}
        loading={busy === 'save'}
        fullWidth
        testID="add-save"
      />
    </Screen>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space[2] }}>
      <Text variant="label" color="textSecondary">
        {label}
      </Text>
      <View style={[styles.wrap, { gap: theme.space[2] }]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { flexDirection: 'row', flexWrap: 'wrap' } });
