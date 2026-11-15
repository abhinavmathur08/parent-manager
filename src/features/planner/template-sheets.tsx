import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { RadioOption } from '@/components/radio-option';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { useOnline } from '@/hooks/use-online';
import { useTheme } from '@/hooks/use-theme';

import {
  deleteTemplate,
  fetchTemplates,
  TEMPLATE_NAME_MAX,
  TemplateRefused,
  type TemplateRefusal,
  type WeekTemplate,
} from './templates';

type ErrorKey = 'name' | 'limit' | 'offline' | 'generic';

function errorKey(error: unknown): ErrorKey | TemplateRefusal {
  if (error instanceof TemplateRefused) return error.reason === 'limit' ? 'limit' : error.reason;
  return 'generic';
}

/** "Save as template" (FR-PLAN-10): names the shown week, up to 60 characters. */
export function SaveTemplateSheet({
  visible,
  onSave,
  onClose,
  onPremiumRequired,
}: {
  visible: boolean;
  onSave: (name: string) => Promise<void>;
  onClose: () => void;
  /** The server refused: the household isn't Premium any more. */
  onPremiumRequired: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const online = useOnline();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);

  const close = () => {
    onClose();
    setName('');
    setError(null);
  };

  async function save() {
    if (!name.trim()) return setError('name');
    if (!online) return setError('offline');
    setSaving(true);
    setError(null);
    try {
      await onSave(name.slice(0, TEMPLATE_NAME_MAX));
      close();
    } catch (caught) {
      const key = errorKey(caught);
      if (key === 'premium_required') {
        close();
        onPremiumRequired();
      } else setError(key);
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      title={t('plan.templates.saveTitle')}
      variant="form"
      footer={
        <Button
          label={t('plan.templates.save')}
          onPress={save}
          loading={saving}
          disabled={saving}
          fullWidth
          testID="template-save"
        />
      }
      testID="save-template-sheet"
    >
      <View style={{ gap: theme.space[2] }}>
        <TextField
          label={t('plan.templates.nameLabel')}
          hint={t('plan.templates.nameHint', { max: TEMPLATE_NAME_MAX })}
          value={name}
          onChangeText={(text) => setName(text.slice(0, TEMPLATE_NAME_MAX))}
          maxLength={TEMPLATE_NAME_MAX}
          error={error ? t(`plan.templates.errors.${error}`) : undefined}
          testID="template-name"
        />
      </View>
    </BottomSheet>
  );
}

/**
 * "Apply a template" (FR-PLAN-10): choose a saved week, then add it to this week or replace
 * this week's entries, as copy last week does.
 */
export function ApplyTemplateSheet({
  visible,
  householdId,
  weekHasEntries,
  onApply,
  onClose,
  onPremiumRequired,
}: {
  visible: boolean;
  householdId: string;
  weekHasEntries: boolean;
  onApply: (template: WeekTemplate, mode: 'add' | 'replace') => void;
  onClose: () => void;
  onPremiumRequired: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const online = useOnline();
  const [templates, setTemplates] = useState<WeekTemplate[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState<ErrorKey | null>(null);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    fetchTemplates(householdId).then(
      (rows) => {
        if (!active) return;
        setTemplates(rows);
        setChosen((current) => current ?? rows[0]?.id ?? null);
      },
      () => active && setError(online ? 'generic' : 'offline'),
    );
    return () => {
      active = false;
    };
  }, [visible, householdId, online]);

  const template = templates?.find((row) => row.id === chosen) ?? null;
  const close = () => {
    onClose();
    setError(null);
  };
  const apply = (mode: 'add' | 'replace') => {
    if (!template) return;
    close();
    onApply(template, mode);
  };

  async function remove() {
    if (!template) return;
    try {
      await deleteTemplate(template.id);
      const rest = (templates ?? []).filter((row) => row.id !== template.id);
      setTemplates(rest);
      setChosen(rest[0]?.id ?? null);
    } catch (caught) {
      if (errorKey(caught) === 'premium_required') {
        close();
        onPremiumRequired();
      } else setError('generic');
    }
  }

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      title={t('plan.templates.applyTitle')}
      footer={
        template ? (
          <View style={{ gap: theme.space[2] }}>
            <Button
              label={t(weekHasEntries ? 'plan.templates.add' : 'plan.templates.applyEmpty')}
              onPress={() => apply('add')}
              fullWidth
              testID="template-apply-add"
            />
            {weekHasEntries ? (
              <Button
                variant="secondary"
                label={t('plan.templates.replace')}
                onPress={() => apply('replace')}
                fullWidth
                testID="template-apply-replace"
              />
            ) : null}
          </View>
        ) : undefined
      }
      testID="apply-template-sheet"
    >
      <View style={{ gap: theme.space[2] }}>
        {templates?.length === 0 ? (
          <Text color="textSecondary" testID="template-none">
            {t('plan.templates.none')}
          </Text>
        ) : null}
        {templates?.map((row, index) => (
          <RadioOption
            key={row.id}
            label={row.name}
            description={t('plan.templates.meals', { count: row.entries.length })}
            selected={row.id === chosen}
            onPress={() => setChosen(row.id)}
            testID={`template-option-${index}`}
          />
        ))}
        {template ? (
          <Button
            variant="ghost"
            label={t('plan.templates.delete')}
            onPress={remove}
            testID="template-delete"
          />
        ) : null}
        {error ? (
          <Text color="error" accessibilityLiveRegion="polite" testID="template-error">
            {t(`plan.templates.errors.${error}`)}
          </Text>
        ) : null}
      </View>
    </BottomSheet>
  );
}
