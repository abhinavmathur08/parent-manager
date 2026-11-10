import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/button';
import { signInWithGoogle } from '@/features/auth/google';

export type GoogleButtonProps = {
  disabled?: boolean;
  onError: (error: unknown) => void;
  testID?: string;
};

/** "Continue with Google" (FR-AUTH-1), a secondary button as in the S-02 mockup. */
export function GoogleButton({ disabled, onError, testID = 'sign-in-google' }: GoogleButtonProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="secondary"
      label={t('auth.google.continue')}
      onPress={async () => {
        if (busy) return;
        setBusy(true);
        try {
          await signInWithGoogle();
        } catch (error) {
          onError(error);
        } finally {
          setBusy(false);
        }
      }}
      loading={busy}
      disabled={disabled}
      fullWidth
      testID={testID}
    />
  );
}
