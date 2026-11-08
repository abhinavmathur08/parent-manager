import { render, renderHook, screen } from '@testing-library/react-native';
import * as ReactNative from 'react-native';

import { Text } from '@/components/text';
import { theme } from '@/constants/theme';
import { ThemeOverride, useTheme } from '@/hooks/use-theme';

const colorScheme = jest.spyOn(ReactNative, 'useColorScheme');

afterEach(() => colorScheme.mockReset());

describe('useTheme', () => {
  it('follows the system light setting', async () => {
    colorScheme.mockReturnValue('light');
    const { result } = await renderHook(() => useTheme());
    expect(result.current.scheme).toBe('light');
    expect(result.current.color.background).toBe(theme.light.color.background);
  });

  it('follows the system dark setting', async () => {
    colorScheme.mockReturnValue('dark');
    const { result } = await renderHook(() => useTheme());
    expect(result.current.scheme).toBe('dark');
    expect(result.current.color.background).toBe(theme.dark.color.background);
  });

  it('can be overridden for a subtree', async () => {
    colorScheme.mockReturnValue('light');
    const { result } = await renderHook(() => useTheme(), {
      wrapper: ({ children }) => <ThemeOverride scheme="dark">{children}</ThemeOverride>,
    });
    expect(result.current.color.primary).toBe(theme.dark.color.primary);
  });
});

describe('Text', () => {
  it('applies the type and color tokens', async () => {
    colorScheme.mockReturnValue('light');
    await render(
      <Text variant="label" color="textSecondary" testID="t">
        {'x'}
      </Text>,
    );
    expect(screen.getByTestId('t')).toHaveStyle({
      fontSize: 15,
      lineHeight: 20,
      color: theme.light.color.textSecondary,
    });
  });

  it('scales size and line height with a font scale override', async () => {
    await render(
      <ThemeOverride fontScale={2}>
        <Text testID="t">{'x'}</Text>
      </ThemeOverride>,
    );
    expect(screen.getByTestId('t')).toHaveStyle({ fontSize: 34, lineHeight: 48 });
  });

  it('never turns off system font scaling', async () => {
    await render(<Text testID="t">{'x'}</Text>);
    expect(screen.getByTestId('t').props.allowFontScaling).not.toBe(false);
  });
});
