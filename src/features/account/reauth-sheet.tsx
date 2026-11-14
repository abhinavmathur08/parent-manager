import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { CODE_LENGTH, CodeInput } from '@/components/code-input';
import { Text } from '@/components/text';
import { isLastParentRefusal, needsReauthentication } from '@/features/account/deletion';
import {
  assertSameAccount,
  DifferentAccountError,
  reauthenticateWithCode,
  reauthenticateWithProvider,
  requestReauthCode,
} from '@/features/account/reauth';
import { signInMethod } from '@/features/account/sign-in-method';
import { authErrorKey } from '@/features/auth/auth-errors';
import { useAuth } from '@/features/auth/session';
import { useOnline } from '@/hooks/use-online';

export type ReauthSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** Translated label of the destructive action, such as "Delete account". */
  actionLabel: string;
  /** Runs once the user has signed in again as the same account. May throw. */
  onConfirmed: () => Promise<void>;
  testID: string;
};

/**
 * Signs the user in again before a deletion (FR-PRIV-3): an emailed code, or Apple or Google,
 * whichever the account uses. The server refuses deletion without a fresh sign-in, and this
 * sheet refuses if the sign-in landed in a different account.
 */
export function ReauthSheet({
  visible,
  onClose,
  actionLabel,
  onConfirmed,
  testID,
}: ReauthSheetProps) {
  const { t } = useTranslation();
  const online = useOnline();
  const auth = useAuth();
  const user = auth.status === 'signedIn' ? auth.session.user : null;
  const method = user ? signInMethod(user) : 'email';
  const email = user?.email ?? '';
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  function describe(caught: unknown): string {
    if (caught instanceof DifferentAccountError) return t('account.reauth.differentAccount');
    if (needsReauthentication(caught)) return t('account.reauth.expired');
    if (isLastParentRefusal(caught)) return t('account.delete.outcome.last_parent');
    return t(`auth.errors.${authErrorKey(caught)}`);
  }

  async function run(step: () => Promise<boolean>) {
    if (!user) return;
    setBusy(true);
    setError(undefined);
    try {
      if (!(await step())) return;
      await assertSameAccount(user.id);
      await onConfirmed();
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(false);
    }
  }

  async function sendCode() {
    if (!email) return;
    setBusy(true);
    setError(undefined);
    try {
      await requestReauthCode(email);
      setCodeSent(true);
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(false);
    }
  }

  const confirmWithCode = (value: string) =>
    run(async () => {
      await reauthenticateWithCode(email, value);
      return true;
    });
  const confirmWithProvider = () =>
    run(
      async () => method !== 'email' && (await reauthenticateWithProvider(method)) === 'signedIn',
    );

  const close = () => {
    setCodeSent(false);
    setCode('');
    setError(undefined);
    onClose();
  };

  let footer: React.ReactNode;
  if (method !== 'email') {
    footer = (
      <Button
        variant="destructive"
        label={t(`account.reauth.continueWith.${method}`)}
        onPress={confirmWithProvider}
        loading={busy}
        disabled={!online || busy}
        fullWidth
        testID={`${testID}-provider`}
      />
    );
  } else if (!codeSent) {
    footer = (
      <Button
        label={t('account.reauth.sendCode')}
        onPress={sendCode}
        loading={busy}
        disabled={!online || busy || !email}
        fullWidth
        testID={`${testID}-send`}
      />
    );
  } else {
    footer = (
      <Button
        variant="destructive"
        label={actionLabel}
        onPress={() => confirmWithCode(code)}
        loading={busy}
        disabled={!online || busy || code.length !== CODE_LENGTH}
        fullWidth
        testID={`${testID}-confirm`}
      />
    );
  }

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      title={t('account.reauth.title')}
      variant="form"
      footer={footer}
      testID={testID}
    >
      <Text testID={`${testID}-body`}>
        {method !== 'email'
          ? t(`account.reauth.provider.${method}`)
          : codeSent
            ? t('account.reauth.codeSent', { email })
            : t('account.reauth.email', { email })}
      </Text>
      {method === 'email' && codeSent ? (
        <CodeInput
          value={code}
          onChange={(value) => {
            setCode(value);
            setError(undefined);
          }}
          accessibilityLabel={t('auth.verify.code')}
          autoFocus
          testID={`${testID}-code`}
        />
      ) : null}
      {error ? (
        <Text color="error" accessibilityLiveRegion="polite" testID={`${testID}-error`}>
          {error}
        </Text>
      ) : null}
    </BottomSheet>
  );
}
