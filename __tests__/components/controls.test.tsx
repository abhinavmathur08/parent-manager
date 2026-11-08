import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { AccessibilityInfo, StyleSheet } from 'react-native';

import { Button } from '@/components/button';
import { IconButton } from '@/components/icon-button';
import { RadioOption } from '@/components/radio-option';
import { SegmentedControl } from '@/components/segmented-control';
import { Stepper, stepValue } from '@/components/stepper';
import { Switch } from '@/components/switch';
import { TextField } from '@/components/text-field';
import { theme } from '@/constants/theme';

const MIN_TARGET = theme.layout.minTarget;

function flat(testID: string) {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style);
}

describe('Button', () => {
  it('has a button role, its label and a 52 pt minimum height', async () => {
    const onPress = jest.fn();
    await render(<Button label="Add a meal" onPress={onPress} testID="b" />);
    const button = screen.getByRole('button', { name: 'Add a meal' });
    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(flat('b').minHeight).toBeGreaterThanOrEqual(MIN_TARGET);
    expect(flat('b').backgroundColor).toBe(theme.light.color.primary);
  });

  it('ignores presses and reports it when disabled', async () => {
    const onPress = jest.fn();
    await render(<Button label="Save" onPress={onPress} disabled testID="b" />);
    await fireEvent.press(screen.getByTestId('b'));
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByTestId('b')).toBeDisabled();
    expect(flat('b').backgroundColor).toBe(theme.light.color.surfaceAlt);
  });

  it('keeps its label for screen readers while loading', async () => {
    const onPress = jest.fn();
    await render(<Button label="Save" onPress={onPress} loading testID="b" />);
    expect(screen.getByTestId('b-spinner')).toBeOnTheScreen();
    expect(screen.getByLabelText('Save')).toBeBusy();
    await fireEvent.press(screen.getByTestId('b'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it.each(['secondary', 'ghost', 'destructive'] as const)(
    'renders the %s variant',
    async (variant) => {
      await render(<Button label="Go" onPress={jest.fn()} variant={variant} testID="b" />);
      const background = flat('b').backgroundColor;
      if (variant === 'destructive') expect(background).toBe(theme.light.color.error);
      else expect(background).toBe('transparent');
    },
  );

  it('shows the focus ring when focused', async () => {
    await render(<Button label="Go" onPress={jest.fn()} testID="b" />);
    await fireEvent(screen.getByTestId('b'), 'focus');
    expect(flat('b').outlineWidth).toBe(3);
    await fireEvent(screen.getByTestId('b'), 'blur');
    expect(flat('b').outlineWidth).toBeUndefined();
  });
});

describe('IconButton', () => {
  it('is a 48 pt target with its translated label', async () => {
    const onPress = jest.fn();
    await render(
      <IconButton icon="close" accessibilityLabel="Close" onPress={onPress} testID="i" />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(onPress).toHaveBeenCalled();
    expect(flat('i').width).toBeGreaterThanOrEqual(MIN_TARGET);
    expect(flat('i').height).toBeGreaterThanOrEqual(MIN_TARGET);
  });

  it('can be disabled', async () => {
    await render(
      <IconButton
        icon="close"
        accessibilityLabel="Close"
        onPress={jest.fn()}
        disabled
        testID="i"
      />,
    );
    expect(screen.getByTestId('i')).toBeDisabled();
  });
});

describe('TextField', () => {
  it('labels the input with its visible label', async () => {
    await render(<TextField label="Recipe name" testID="f" />);
    expect(screen.getByLabelText('Recipe name')).toBeOnTheScreen();
    expect(screen.getByText('Recipe name')).toBeOnTheScreen();
  });

  it('shows errors as text, not color only', async () => {
    await render(<TextField label="Email" error="Enter an email address" testID="f" />);
    expect(screen.getByTestId('f-error')).toHaveTextContent('Enter an email address');
    expect(screen.getByTestId('f').props.accessibilityHint).toBe('Enter an email address');
  });

  it('cannot be edited when disabled', async () => {
    await render(<TextField label="Name" disabled testID="f" />);
    expect(screen.getByTestId('f').props.editable).toBe(false);
  });

  it('clears a search with a translated clear button', async () => {
    function Search() {
      const [text, setText] = useState('milk');
      return (
        <TextField
          variant="search"
          accessibilityLabel="Search"
          value={text}
          onChangeText={setText}
          testID="s"
        />
      );
    }
    await render(<Search />);
    await fireEvent.press(screen.getByRole('button', { name: 'Clear text' }));
    expect(screen.getByTestId('s').props.value).toBe('');
    expect(screen.queryByTestId('s-clear')).toBeNull();
  });

  it('reports focus to its caller', async () => {
    const onFocus = jest.fn();
    await render(<TextField label="Name" onFocus={onFocus} testID="f" />);
    await fireEvent(screen.getByTestId('f'), 'focus');
    expect(onFocus).toHaveBeenCalled();
  });
});

describe('stepValue', () => {
  it('clamps to the range', () => {
    expect(stepValue(1, -1, 1, 10)).toBe(1);
    expect(stepValue(10, 1, 1, 10)).toBe(10);
    expect(stepValue(4, 1, 1, 10)).toBe(5);
  });

  it('avoids floating-point drift', () => {
    expect(stepValue(0.1, 0.2, 0, 1)).toBe(0.3);
  });
});

describe('Stepper', () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  afterEach(() => announce.mockClear());

  function Servings({ initial = 2 }: { initial?: number }) {
    const [value, setValue] = useState(initial);
    return (
      <Stepper
        value={value}
        onChange={setValue}
        min={1}
        max={3}
        accessibilityLabel="Servings"
        testID="st"
      />
    );
  }

  it('changes the value and announces it', async () => {
    await render(<Servings />);
    await fireEvent.press(screen.getByRole('button', { name: 'Increase Servings' }));
    expect(screen.getByTestId('st-value')).toHaveTextContent('3');
    expect(announce).toHaveBeenCalledWith('Servings: 3');
  });

  it('disables the button at the limit', async () => {
    await render(<Servings initial={1} />);
    expect(screen.getByTestId('st-decrease')).toBeDisabled();
    expect(screen.getByTestId('st-increase')).not.toBeDisabled();
  });

  it('is one adjustable element for screen readers', async () => {
    await render(<Servings />);
    const stepper = screen.getByTestId('st');
    expect(stepper.props.accessibilityRole).toBe('adjustable');
    expect(stepper.props.accessibilityValue).toEqual({ text: '2' });
    await fireEvent(stepper, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    expect(screen.getByTestId('st-value')).toHaveTextContent('1');
  });

  it('uses 48 pt buttons', async () => {
    await render(<Servings />);
    expect(flat('st-increase').width).toBeGreaterThanOrEqual(MIN_TARGET);
  });
});

describe('Switch', () => {
  it('toggles from anywhere on the row and reports its state', async () => {
    function Row() {
      const [on, setOn] = useState(false);
      return <Switch label="Reminders" value={on} onValueChange={setOn} testID="sw" />;
    }
    await render(<Row />);
    const row = screen.getByRole('switch', { name: 'Reminders' });
    expect(row).not.toBeChecked();
    await fireEvent.press(row);
    expect(row).toBeChecked();
    expect(flat('sw-track').backgroundColor).toBe(theme.light.color.primary);
    expect(flat('sw').minHeight).toBeGreaterThanOrEqual(theme.layout.minRowHeight);
  });

  it('shows the off outline', async () => {
    await render(<Switch label="Reminders" value={false} onValueChange={jest.fn()} testID="sw" />);
    expect(flat('sw-track').borderColor).toBe(theme.light.color.textSecondary);
  });

  it('can be disabled', async () => {
    const change = jest.fn();
    await render(
      <Switch label="Reminders" value={false} onValueChange={change} disabled testID="sw" />,
    );
    await fireEvent.press(screen.getByTestId('sw'));
    expect(change).not.toHaveBeenCalled();
  });
});

describe('SegmentedControl', () => {
  it('selects an option and marks it selected', async () => {
    function Views() {
      const [view, setView] = useState<'week' | 'day'>('week');
      return (
        <SegmentedControl
          options={[
            { value: 'week', label: 'Week' },
            { value: 'day', label: 'Day' },
          ]}
          value={view}
          onChange={setView}
          accessibilityLabel="View"
          testID="seg"
        />
      );
    }
    await render(<Views />);
    expect(screen.getByRole('tab', { name: 'Week' })).toBeSelected();
    await fireEvent.press(screen.getByRole('tab', { name: 'Day' }));
    expect(screen.getByRole('tab', { name: 'Day' })).toBeSelected();
    expect(screen.getByRole('tab', { name: 'Week' })).not.toBeSelected();
  });

  it('reaches a 48 pt target with its hit slop', async () => {
    await render(
      <SegmentedControl
        options={[{ value: 'a', label: 'A' }]}
        value="a"
        onChange={jest.fn()}
        accessibilityLabel="View"
        testID="seg"
      />,
    );
    const segment = screen.getByTestId('seg-a');
    const { top, bottom } = segment.props.hitSlop;
    expect(flat('seg-a').minHeight + top + bottom).toBeGreaterThanOrEqual(MIN_TARGET);
  });
});

describe('RadioOption', () => {
  it('is a radio with its checked state and a 64 pt minimum', async () => {
    const onPress = jest.fn();
    await render(<RadioOption label="United States" selected onPress={onPress} testID="r" />);
    const radio = screen.getByRole('radio', { name: 'United States' });
    expect(radio).toBeChecked();
    await fireEvent.press(radio);
    expect(onPress).toHaveBeenCalled();
    expect(flat('r').minHeight).toBeGreaterThanOrEqual(64);
    expect(flat('r').borderColor).toBe(theme.light.color.primary);
  });

  it('shows the unselected state', async () => {
    await render(
      <RadioOption label="United Kingdom" selected={false} onPress={jest.fn()} testID="r" />,
    );
    expect(screen.getByRole('radio')).not.toBeChecked();
    expect(flat('r').borderColor).toBe(theme.light.color.border);
  });
});
