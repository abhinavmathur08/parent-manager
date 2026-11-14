// Sentry's SDK pulls in ES modules Jest doesn't transform, and its native module isn't in
// Jest. Every function the app calls is a mock (src/lib/crash-reporting.ts).
export const init = jest.fn();
export const wrap = jest.fn(<T>(component: T) => component);
export const setUser = jest.fn();
export const captureException = jest.fn();
export const getGlobalScope = jest.fn(() => ({ setTag: jest.fn() }));
