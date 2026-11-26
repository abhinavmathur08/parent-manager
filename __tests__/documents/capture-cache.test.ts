// SR2-M1 (#314): capture files are swept at launch and at sign-out, since drafts live in
// memory only and a killed app can't name its files.
const mockDirectories: { uri: string; deleted: boolean }[] = [];
jest.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///cache' },
  Directory: jest.fn().mockImplementation((base: string, name: string) => {
    const dir = {
      uri: `${base}/${name}`,
      exists: true,
      deleted: false,
      create: () => {},
      delete: () => {
        dir.deleted = true;
      },
    };
    mockDirectories.push(dir);
    return dir;
  }),
  File: jest.fn(),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'x' }));
const mockCleanups: (() => void)[] = [];
jest.mock('@/features/auth/sign-out', () => ({
  onSignOut: (cleanup: () => void) => mockCleanups.push(cleanup),
}));

const cleared = () =>
  mockDirectories.filter((d) => d.uri === 'file:///cache/vault-capture' && d.deleted).length;

it('deletes the capture folder at launch', () => {
  jest.isolateModules(() => require('@/features/documents/capture-cache'));
  expect(cleared()).toBe(1);
});

it('deletes the capture folder at sign-out', () => {
  expect(mockCleanups).toHaveLength(1);
  mockCleanups[0]();
  expect(cleared()).toBe(2);
});
