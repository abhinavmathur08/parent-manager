import type { ExpoConfig } from 'expo/config';

import appConfig, { getAppVariant } from '../app.config';
import easJson from '../eas.json';
import packageJson from '../package.json';

function configFor(variant: string | undefined): ExpoConfig {
  const previous = process.env.APP_VARIANT;
  if (variant === undefined) {
    delete process.env.APP_VARIANT;
  } else {
    process.env.APP_VARIANT = variant;
  }
  try {
    return appConfig({
      config: {},
      projectRoot: '',
      staticConfigPath: null,
      packageJsonPath: null,
    });
  } finally {
    if (previous === undefined) {
      delete process.env.APP_VARIANT;
    } else {
      process.env.APP_VARIANT = previous;
    }
  }
}

describe('app variants (F-03.1)', () => {
  it.each([
    ['development', 'com.myparentmanager.dev', 'Parent Manager (Dev)', 'parentmanager-dev'],
    ['preview', 'com.myparentmanager.preview', 'Parent Manager (Preview)', 'parentmanager-preview'],
    ['production', 'com.myparentmanager', 'Parent Manager', 'parentmanager'],
  ])('gives %s its own app ID, name and scheme', (variant, id, name, scheme) => {
    const config = configFor(variant);
    expect(config.ios?.bundleIdentifier).toBe(id);
    expect(config.android?.package).toBe(id);
    expect(config.name).toBe(name);
    expect(config.scheme).toBe(scheme);
    expect(config.extra?.appVariant).toBe(variant);
  });

  it('gives every variant a different app ID, so they install side by side', () => {
    const ids = ['development', 'preview', 'production'].map(
      (v) => configFor(v).ios?.bundleIdentifier,
    );
    expect(new Set(ids).size).toBe(3);
  });

  it('defaults to production when APP_VARIANT is not set', () => {
    expect(getAppVariant(undefined)).toBe('production');
    expect(getAppVariant('')).toBe('production');
    expect(configFor(undefined).ios?.bundleIdentifier).toBe('com.myparentmanager');
  });

  it('rejects an unknown variant instead of guessing', () => {
    expect(() => getAppVariant('staging')).toThrow(/Unknown APP_VARIANT "staging"/);
  });

  it('keeps the EAS project and owner the same for every variant', () => {
    for (const variant of ['development', 'preview', 'production']) {
      const config = configFor(variant);
      expect(config.owner).toBe('abhinav08');
      expect(config.extra?.eas?.projectId).toBe('4981939e-671f-44b5-b428-9fa2a5338d17');
    }
  });
});

describe('over-the-air updates (F-03.3)', () => {
  const eas = easJson as {
    build: Record<string, { channel?: string; extends?: string; env?: Record<string, string> }>;
  };
  const pkg = packageJson as { scripts: Record<string, string> };

  it('uses a fingerprint runtime version, so native changes never get incompatible updates', () => {
    const config = configFor('production');
    expect(config.runtimeVersion).toEqual({ policy: 'fingerprint' });
    expect(config.updates?.url).toBe('https://u.expo.dev/4981939e-671f-44b5-b428-9fa2a5338d17');
  });

  it('gives each build profile the channel named after its variant', () => {
    for (const profile of ['development', 'preview', 'production']) {
      expect(eas.build[profile].channel).toBe(profile);
      expect(eas.build[profile].env?.APP_VARIANT).toBe(profile);
    }
    // The simulator build is the development variant, so it shares that channel.
    expect(eas.build['development-simulator'].extends).toBe('development');
    expect(eas.build['development-simulator'].channel).toBeUndefined();
  });

  it('only scripts publishing to preview, never to production', () => {
    const updateScripts = Object.values(pkg.scripts).filter((s) => / update\b/.test(s));
    expect(updateScripts).toEqual([
      'APP_VARIANT=preview pnpm dlx eas-cli@latest update --channel preview --environment preview',
    ]);
  });
});
