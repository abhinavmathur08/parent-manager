import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';

import { Banner } from '@/components/banner';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { AllowanceNotice, useAiAllowance } from '@/features/subscription/allowance-notice';
import { useDraftState } from '@/hooks/use-draft-state';
import { useOnline } from '@/hooks/use-online';
import { useTheme } from '@/hooks/use-theme';
import { track } from '@/lib/analytics';

import { isLinkProblem, isRetryable, type ImportErrorCode, type ImportInput } from './api';
import { setManualPrefill } from './manual';
import { useImportRun } from './use-import-run';

/** The input type as analytics names it (spec section 3.5). */
export const analyticsInput = (input: ImportInput) => (input.type === 'link' ? 'url' : 'text');

/** The translation key of an error's explanation: `import.timeout` is `importRecipe.errors.timeout`. */
export const errorKey = (code: ImportErrorCode) => `importRecipe.errors.${code.slice(7)}`;

/**
 * S-19 and S-20: choose a link or pasted text, see the month's allowance, then wait while the
 * server parses. The member can leave while it runs; coming back shows the result (FR-AI-1 to
 * FR-AI-3, FR-AI-10, FR-AI-11). Every draft goes to review (S-21) before anything is saved.
 */
export function ImportScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const online = useOnline();
  const { run, start, reset } = useImportRun();
  const [link, setLink, clearLink] = useDraftState('import:link', '');
  const [text, setText, clearText] = useDraftState('import:text', '');
  const [refresh, setRefresh] = useState(0);
  const allowance = useAiAllowance(refresh);

  const reported = useRef<string | null>(null);
  useEffect(() => {
    if (run.phase === 'succeeded') {
      clearLink();
      clearText();
      router.replace({ pathname: '/recipes/import/review', params: { job: run.pending.jobId } });
    } else if (run.phase === 'failed' && reported.current !== run.pending.jobId) {
      reported.current = run.pending.jobId;
      setRefresh((n) => n + 1);
      track('ai_import_failed', {
        input_type: analyticsInput(run.pending.input),
        error_code: run.code,
      });
    }
  }, [run, clearLink, clearText]);

  function begin(input: ImportInput) {
    track('ai_import_started', {
      input_type: analyticsInput(input),
      allowance_remaining: allowance ? Math.max(0, allowance.allowance - allowance.used) : 0,
    });
    start(input);
  }

  function enterManually(input: ImportInput) {
    setManualPrefill(
      input.type === 'link' ? { sourceUrl: input.url } : { notes: input.text.slice(0, 5000) },
    );
    reset();
    router.replace({ pathname: '/recipes/edit', params: { from: 'import' } });
  }

  if (run.phase === 'running' || run.phase === 'succeeded') {
    return (
      <Screen
        title={t('importRecipe.progress.title')}
        onBack={() => router.back()}
        hasTabBar={false}
        testID="import-progress"
      >
        <Card testID="import-progress-card">
          <View style={{ gap: theme.space[4], alignItems: 'center' }}>
            <ActivityIndicator
              color={theme.color.primary}
              accessibilityLabel={t('importRecipe.progress.reading')}
            />
            <Text variant="bodyStrong" accessibilityRole="header">
              {t('importRecipe.progress.reading')}
            </Text>
            <Text color="textSecondary">{t('importRecipe.progress.canLeave')}</Text>
          </View>
        </Card>
        <Button
          variant="ghost"
          label={t('importRecipe.progress.cancel')}
          onPress={reset}
          testID="import-progress-cancel"
        />
      </Screen>
    );
  }

  if (run.phase === 'failed') {
    const { code, pending } = run;
    return (
      <Screen
        title={t('importRecipe.title')}
        onBack={() => router.back()}
        hasTabBar={false}
        testID="import-error"
      >
        {code === 'import.quota_exceeded' ? <AllowanceNotice allowance={allowance} /> : null}
        <Card testID="import-error-card">
          <Text accessibilityRole="alert" testID="import-error-message">
            {t(errorKey(code))}
          </Text>
        </Card>
        <View style={{ gap: theme.space[3] }}>
          {isRetryable(code) ? (
            <Button
              label={t('importRecipe.retry')}
              onPress={() => begin(pending.input)}
              disabled={!online}
              fullWidth
              testID="import-retry"
            />
          ) : null}
          {pending.input.type === 'link' && isLinkProblem(code) ? (
            <Button
              variant="secondary"
              label={t('importRecipe.pasteTextInstead')}
              onPress={reset}
              fullWidth
              testID="import-paste-text"
            />
          ) : null}
          <Button
            variant="secondary"
            label={t('importRecipe.enterManually')}
            onPress={() => enterManually(pending.input)}
            fullWidth
            testID="import-enter-manually"
          />
          <Button
            variant="ghost"
            label={t('importRecipe.startOver')}
            onPress={reset}
            fullWidth
            testID="import-start-over"
          />
        </View>
      </Screen>
    );
  }

  const linkText = link.trim();
  const pasted = text.trim();
  return (
    <Screen
      title={t('importRecipe.title')}
      onBack={() => router.back()}
      hasTabBar={false}
      banner={
        online ? null : (
          <Banner variant="offline" message={t('importRecipe.offline')} testID="import-offline" />
        )
      }
      testID="import-screen"
    >
      <AllowanceNotice allowance={allowance} />
      <View style={{ gap: theme.space[3] }}>
        <Text variant="sectionLabel" accessibilityRole="header">
          {t('importRecipe.fromLink')}
        </Text>
        <TextField
          label={t('importRecipe.linkLabel')}
          hint={t('importRecipe.linkHint')}
          value={link}
          onChangeText={setLink}
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={2048}
          disabled={!online}
          testID="import-link-input"
        />
        <Button
          label={t('importRecipe.importLink')}
          onPress={() => begin({ type: 'link', url: linkText })}
          disabled={!online || !linkText}
          fullWidth
          testID="import-link-submit"
        />
      </View>
      <View style={{ gap: theme.space[3] }}>
        <Text variant="sectionLabel" accessibilityRole="header">
          {t('importRecipe.fromText')}
        </Text>
        <TextField
          label={t('importRecipe.textLabel')}
          hint={t('importRecipe.textHint')}
          value={text}
          onChangeText={setText}
          multiline
          maxLength={20_000}
          disabled={!online}
          testID="import-text-input"
        />
        <Button
          label={t('importRecipe.importText')}
          onPress={() => begin({ type: 'text', text: pasted })}
          disabled={!online || !pasted}
          fullWidth
          testID="import-text-submit"
        />
      </View>
      <Button
        variant="ghost"
        label={t('importRecipe.addByHand')}
        onPress={() => router.replace('/recipes/edit')}
        testID="import-manual"
      />
    </Screen>
  );
}
