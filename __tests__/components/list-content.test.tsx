import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import * as ReactNative from 'react-native';
import { StyleSheet } from 'react-native';

import { Avatar, AvatarGroup, avatarFill, initialOf } from '@/components/avatar';
import { Card } from '@/components/card';
import { Checkbox } from '@/components/checkbox';
import { CheckboxRow } from '@/components/checkbox-row';
import { Chip } from '@/components/chip';
import { ListRow } from '@/components/list-row';
import { ProgressBar, progressFraction } from '@/components/progress-bar';
import { SectionHeader } from '@/components/section-header';
import { Tag } from '@/components/tag';
import { theme } from '@/constants/theme';

const colorScheme = jest.spyOn(ReactNative, 'useColorScheme');
afterEach(() => colorScheme.mockReset());

function flat(testID: string) {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style);
}

describe('ListRow', () => {
  it('is at least 56 pt tall and the whole row is the target', async () => {
    const onPress = jest.fn();
    await render(<ListRow title="Region" variant="navigation" onPress={onPress} testID="row" />);
    await fireEvent.press(screen.getByRole('button', { name: 'Region' }));
    expect(onPress).toHaveBeenCalled();
    expect(flat('row').minHeight).toBeGreaterThanOrEqual(56);
  });

  it('reads the trailing value with the title', async () => {
    await render(
      <ListRow title="Units" variant="value" value="Metric" onPress={jest.fn()} testID="row" />,
    );
    expect(screen.getByRole('button', { name: 'Units, Metric' })).toBeOnTheScreen();
  });

  it('is not a button without an action', async () => {
    await render(<ListRow title="Version" testID="row" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('insets its divider from the leading edge', async () => {
    await render(<ListRow title="A" divider testID="row" />);
    expect(flat('row-divider').start).toBe(theme.space[4]);
  });
});

describe('Checkbox', () => {
  it('is a 48 pt target that toggles', async () => {
    function Box() {
      const [checked, setChecked] = useState(false);
      return (
        <Checkbox checked={checked} onChange={setChecked} accessibilityLabel="Milk" testID="cb" />
      );
    }
    await render(<Box />);
    const box = screen.getByRole('checkbox', { name: 'Milk' });
    expect(box).not.toBeChecked();
    await fireEvent.press(box);
    expect(box).toBeChecked();
    expect(flat('cb').width).toBeGreaterThanOrEqual(48);
    expect(flat('cb-mark').width).toBe(26);
    expect(flat('cb-mark').backgroundColor).toBe(theme.light.color.primary);
  });
});

describe('CheckboxRow', () => {
  function Item({ by }: { by?: { name: string; memberIndex: number } }) {
    const [checked, setChecked] = useState(false);
    return (
      <CheckboxRow
        label="Milk"
        detail="2 L"
        checked={checked}
        onToggle={setChecked}
        checkedBy={by}
        testID="item"
      />
    );
  }

  it('toggles from anywhere on the row', async () => {
    await render(<Item />);
    await fireEvent.press(screen.getByTestId('item'));
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(flat('item').minHeight).toBeGreaterThanOrEqual(56);
  });

  it('shows checked state by more than color', async () => {
    await render(<Item />);
    await fireEvent.press(screen.getByTestId('item'));
    expect(flat('item-label').textDecorationLine).toBe('line-through');
    expect(flat('item-label').color).toBe(theme.light.color.textSecondary);
    expect(screen.getByTestId('item-mark')).toBeOnTheScreen();
  });

  it('names the member who checked it', async () => {
    await render(<Item by={{ name: 'Alex', memberIndex: 0 }} />);
    expect(screen.queryByTestId('item-avatar')).toBeNull();
    await fireEvent.press(screen.getByTestId('item'));
    expect(screen.getByRole('checkbox', { name: 'Milk, 2 L, checked by Alex' })).toBeChecked();
    expect(screen.getByTestId('item-avatar')).toBeOnTheScreen();
  });

  it('shows and announces a pending sync', async () => {
    await render(
      <CheckboxRow label="Eggs" checked={false} onToggle={jest.fn()} pendingSync testID="item" />,
    );
    expect(screen.getByTestId('item-pending', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.getByRole('checkbox', { name: 'Eggs, waiting to sync' })).toBeOnTheScreen();
  });
});

describe('Avatar', () => {
  it('shows only the initial', async () => {
    await render(<Avatar name="alex" memberIndex={0} testID="av" />);
    expect(screen.getByTestId('av')).toHaveTextContent('A');
    expect(screen.getByLabelText('alex')).toBeOnTheScreen();
  });

  it('has a textSecondary ring in light mode', async () => {
    colorScheme.mockReturnValue('light');
    await render(<Avatar name="Sam" memberIndex={1} testID="av" />);
    expect(flat('av')).toMatchObject({
      borderWidth: 1.5,
      borderColor: theme.light.color.textSecondary,
      backgroundColor: theme.light.color.avatarSage,
    });
  });

  it('has a 2 pt surface ring in dark mode', async () => {
    colorScheme.mockReturnValue('dark');
    await render(<Avatar name="Sam" memberIndex={1} testID="av" />);
    expect(flat('av')).toMatchObject({ borderWidth: 2, borderColor: theme.dark.color.surface });
  });

  it('reads a group as one labelled element', async () => {
    await render(
      <AvatarGroup
        members={[
          { name: 'Alex', memberIndex: 0 },
          { name: 'Sam', memberIndex: 1 },
        ]}
        accessibilityLabel="Alex and Sam"
        testID="group"
      />,
    );
    expect(screen.getByLabelText('Alex and Sam')).toBeOnTheScreen();
    expect(screen.getByTestId('group')).toHaveTextContent('AS');
  });
});

describe('avatar helpers', () => {
  it('takes the first character, even outside the basic plane', () => {
    expect(initialOf('  zoë')).toBe('Z');
    expect(initialOf('𝒜da')).toBe('𝒜');
    expect(initialOf('')).toBe('');
  });

  it('cycles fills for later members', () => {
    expect(avatarFill(0)).toBe('avatarSand');
    expect(avatarFill(1)).toBe('avatarSage');
    expect(avatarFill(2)).toBe('avatarSand');
  });
});

describe('Chip', () => {
  it('marks a selected filter with a fill and a check', async () => {
    await render(<Chip label="Vegetarian" selected onPress={jest.fn()} testID="chip" />);
    const chip = screen.getByRole('togglebutton', { name: 'Vegetarian' });
    expect(chip.props.accessibilityState.checked).toBe(true);
    expect(flat('chip').backgroundColor).toBe(theme.light.color.primary);
  });

  it('reaches a 48 pt target', async () => {
    await render(<Chip label="Milk" variant="action" onPress={jest.fn()} testID="chip" />);
    const { top, bottom } = screen.getByTestId('chip').props.hitSlop;
    expect(flat('chip').minHeight + top + bottom).toBeGreaterThanOrEqual(48);
    expect(screen.getByRole('button', { name: 'Milk' })).toBeOnTheScreen();
  });

  it('does nothing when disabled', async () => {
    const onPress = jest.fn();
    await render(<Chip label="Milk" onPress={onPress} disabled testID="chip" />);
    await fireEvent.press(screen.getByTestId('chip'));
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('Tag', () => {
  it('shows the warning in text with an outline', async () => {
    await render(<Tag label="Contains peanuts" variant="warning" testID="tag" />);
    expect(screen.getByTestId('tag')).toHaveTextContent('Contains peanuts');
    expect(flat('tag').borderColor).toBe(theme.light.color.warning);
  });
});

describe('Card', () => {
  it('is static by default, with a border and no shadow', async () => {
    await render(<Card testID="card">{null}</Card>);
    expect(flat('card')).toMatchObject({ borderWidth: 1, borderRadius: theme.radius.card });
    expect(flat('card').shadowOpacity).toBeUndefined();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('becomes a button when tappable', async () => {
    const onPress = jest.fn();
    await render(
      <Card variant="highlight" onPress={onPress} accessibilityLabel="Tonight: tacos" testID="card">
        {null}
      </Card>,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Tonight: tacos' }));
    expect(onPress).toHaveBeenCalled();
    expect(flat('card').borderColor).toBe(theme.light.color.primary);
  });
});

describe('SectionHeader', () => {
  it('is a heading', async () => {
    await render(<SectionHeader title="Produce" trailing="4" testID="h" />);
    expect(screen.getByRole('header', { name: 'Produce' })).toBeOnTheScreen();
  });

  it('uses the overline style for groups', async () => {
    await render(<SectionHeader title="Privacy" variant="group" testID="h" />);
    expect(flat('h').textTransform).toBe('uppercase');
  });
});

describe('ProgressBar', () => {
  it('pairs the bar with text and reports its value', async () => {
    await render(
      <ProgressBar
        value={6}
        total={7}
        label="6 of 7 dinners planned"
        variant="segmented"
        testID="p"
      />,
    );
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveTextContent('6 of 7 dinners planned');
    expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 7, now: 6 });
    expect(flat('p-segment-5').backgroundColor).toBe(theme.light.color.primary);
    expect(flat('p-segment-6').backgroundColor).toBe(theme.light.color.surfaceAlt);
  });

  it('fills a linear bar to its fraction', async () => {
    await render(<ProgressBar value={1} total={4} label="1 of 4" testID="p" />);
    expect(flat('p-fill').width).toBe('25%');
  });

  it('clamps the fraction', () => {
    expect(progressFraction(5, 4)).toBe(1);
    expect(progressFraction(-1, 4)).toBe(0);
    expect(progressFraction(1, 0)).toBe(0);
  });
});
