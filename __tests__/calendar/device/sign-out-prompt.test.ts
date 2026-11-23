import { Alert, type AlertButton } from 'react-native';

import { signOutAskingAboutCopies } from '@/features/calendar/device/sign-out-prompt';
import { i18n } from '@/i18n';

let mockHasCopies = true;
const mockBefore = jest.fn(async (_remove: boolean) => undefined);
jest.mock('@/features/calendar/device/copy-sync', () => ({
  hasCopies: () => mockHasCopies,
  beforeSignOut: (remove: boolean) => mockBefore(remove),
}));
const mockSignOut = jest.fn(async () => undefined);
jest.mock('@/features/auth/sign-out', () => ({ signOut: () => mockSignOut() }));

/** Answers the alert by pressing the button with this text. */
function answer(text: string | null) {
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _body, buttons, options) => {
    if (text === null) return options?.onDismiss?.();
    (buttons as AlertButton[]).find((b) => b.text === text)?.onPress?.();
  });
}

const t = i18n.t.bind(i18n);

beforeEach(() => {
  jest.clearAllMocks();
  mockHasCopies = true;
});

describe('signing out with copies on the phone (FR2-PRIV-4)', () => {
  it('signs straight out when this phone has no copies', async () => {
    mockHasCopies = false;
    const alert = jest.spyOn(Alert, 'alert');
    await signOutAskingAboutCopies(t);
    expect(alert).not.toHaveBeenCalled();
    expect(mockBefore).not.toHaveBeenCalled();
    expect(mockSignOut).toHaveBeenCalled();
  });

  it('keeps the copies when asked to', async () => {
    answer('Keep them');
    await signOutAskingAboutCopies(t);
    expect(mockBefore).toHaveBeenCalledWith(false);
    expect(mockSignOut).toHaveBeenCalled();
  });

  it('removes the copies before signing out', async () => {
    answer('Remove them');
    await signOutAskingAboutCopies(t);
    expect(mockBefore).toHaveBeenCalledWith(true);
    expect(mockSignOut).toHaveBeenCalled();
  });

  it('stays signed in on Cancel or a dismissed alert', async () => {
    answer('Cancel');
    await signOutAskingAboutCopies(t);
    answer(null);
    await signOutAskingAboutCopies(t);
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(mockBefore).not.toHaveBeenCalled();
  });
});
