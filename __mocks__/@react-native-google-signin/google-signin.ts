// The native Google sign-in module isn't in Jest. Tests that sign in mock it themselves
// (__tests__/auth/google.test.tsx); this keeps everything else that imports it loading.
export const GoogleSignin = {
  configure: jest.fn(),
  hasPlayServices: jest.fn(async () => true),
  signIn: jest.fn(async () => ({ type: 'cancelled', data: null })),
  signOut: jest.fn(async () => null),
};
export const statusCodes = { SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED', IN_PROGRESS: 'IN_PROGRESS' };
export const isSuccessResponse = (response: { type: string }) => response.type === 'success';
export const isErrorWithCode = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error;
