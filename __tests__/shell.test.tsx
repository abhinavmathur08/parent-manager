import { fireEvent, render, screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import HouseholdScreen from '@/app/(tabs)/household';
import { TAB_BAR_FOOTPRINT, TAB_HEIGHT, TabButton } from '@/components/floating-tab-bar';
import { Screen } from '@/components/screen';
import { TopBar } from '@/components/top-bar';
import { theme } from '@/constants/theme';
import { GalleryScreen, LARGEST_TEXT_SCALE } from '@/features/gallery/gallery-screen';

let mockConfig: { url: string; publishableKey: string } | null = null;

jest.mock('@/lib/supabase-config', () => ({
  get supabaseConfig() {
    return mockConfig;
  },
}));

const fs = jest.requireActual<{
  readFileSync(path: string, encoding: 'utf8'): string;
  readdirSync(path: string): string[];
}>('fs');

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function withSafeArea(node: React.ReactElement) {
  return <SafeAreaProvider initialMetrics={metrics}>{node}</SafeAreaProvider>;
}

function flat(testID: string) {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style);
}

describe('navigation shell', () => {
  it('opens on Plan and switches tabs from the floating tab bar', async () => {
    await renderRouter(`${process.cwd()}/src/app`, { initialUrl: '/' });
    expect(await screen.findByTestId('plan-screen-title')).toHaveTextContent('Plan');
    expect(screen.getByRole('tab', { name: 'Plan' })).toBeSelected();

    for (const name of ['list', 'recipes', 'household'] as const) {
      await fireEvent.press(screen.getByTestId(`tab-${name}`));
      expect(await screen.findByTestId(`${name}-screen`)).toBeOnTheScreen();
      expect(screen.getByTestId(`tab-${name}`)).toBeSelected();
    }
    expect(screen.getAllByRole('tab')).toHaveLength(4);
  });
});

describe('FloatingTabBar', () => {
  it('has 52 pt tabs and fits inside the content clearance', async () => {
    expect(TAB_HEIGHT).toBe(52);
    expect(TAB_BAR_FOOTPRINT).toBeLessThanOrEqual(theme.layout.tabBarClearance);
    await render(<TabButton icon="plan" label="Plan" isFocused testID="tab" />);
    expect(flat('tab').minHeight).toBe(52);
    expect(flat('tab').backgroundColor).toBe(theme.light.color.surfaceAlt);
  });

  it('caps only the tab label at 1.3x', async () => {
    await render(<TabButton icon="plan" label="Plan" testID="tab" />);
    expect(screen.getByText('Plan').props.maxFontSizeMultiplier).toBe(1.3);
  });
});

describe('Screen', () => {
  it('pads content so nothing sits under the tab bar', async () => {
    await render(
      withSafeArea(
        <Screen title="Plan" testID="s">
          {null}
        </Screen>,
      ),
    );
    const scroll = screen.getByTestId('s-scroll');
    const content = StyleSheet.flatten(scroll.props.contentContainerStyle);
    expect(content.paddingBottom).toBe(theme.layout.tabBarClearance + metrics.insets.bottom);
    expect(content.maxWidth).toBe(theme.layout.maxContentWidth);
  });
});

describe('TopBar', () => {
  it('has a heading, a translated back button and text actions', async () => {
    const onBack = jest.fn();
    const onEdit = jest.fn();
    await render(
      <TopBar
        title="Recipes"
        onBack={onBack}
        actions={[{ label: 'Edit', onPress: onEdit, testID: 'edit' }]}
        testID="top"
      />,
    );
    expect(screen.getByRole('header', { name: 'Recipes' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Edit' }));
    expect(onBack).toHaveBeenCalled();
    expect(onEdit).toHaveBeenCalled();
  });
});

describe('Household placeholder', () => {
  it('reports when Supabase is not configured', async () => {
    mockConfig = null;
    await render(withSafeArea(<HouseholdScreen />));
    expect(screen.getByTestId('supabase-status')).toHaveTextContent('Supabase: not configured');
  });

  it('reports when Supabase is configured', async () => {
    mockConfig = { url: 'https://abc.supabase.co', publishableKey: 'k' };
    await render(withSafeArea(<HouseholdScreen />));
    expect(screen.getByTestId('supabase-status')).toHaveTextContent('Supabase: configured');
  });
});

describe('component gallery', () => {
  it('shows every shared component', () => {
    const source = fs.readFileSync(
      `${process.cwd()}/src/features/gallery/gallery-screen.tsx`,
      'utf8',
    );
    // Layout pieces the gallery itself is built from, or shown through other components.
    const shownElsewhere = ['screen', 'placeholder-screen', 'icon'];
    const components = fs
      .readdirSync(`${process.cwd()}/src/components`)
      .filter((file) => file.endsWith('.tsx'))
      .map((file) => file.replace(/\.tsx$/, ''))
      .filter((name) => !shownElsewhere.includes(name));
    for (const name of components) {
      expect(source).toContain(`'@/components/${name}'`);
    }
  });

  it('switches to dark mode and the largest text size', async () => {
    await render(withSafeArea(<GalleryScreen />));
    expect(flat('gallery').backgroundColor).toBe(theme.light.color.background);

    await fireEvent.press(screen.getByTestId('gallery-appearance-dark'));
    expect(flat('gallery').backgroundColor).toBe(theme.dark.color.background);

    await fireEvent.press(screen.getByTestId('gallery-text-size-largest'));
    expect(flat('gallery-title').fontSize).toBeCloseTo(
      theme.type.screenTitle.fontSize * LARGEST_TEXT_SCALE,
    );
  });
});
