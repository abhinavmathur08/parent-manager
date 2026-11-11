import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { Person } from '@/features/people/data';
import { PeopleProfilesScreen } from '@/features/people/people-screen';

const mockFetchPeople = jest.fn();
const mockFetchCanEdit = jest.fn();
const mockAddPerson = jest.fn();
const mockUpdatePerson = jest.fn();
const mockRemovePerson = jest.fn();
const mockSetDietary = jest.fn();

jest.mock('@/features/people/data', () => ({
  ...jest.requireActual('@/features/people/data'),
  fetchPeople: (...args: unknown[]) => mockFetchPeople(...args),
  fetchCanEdit: (...args: unknown[]) => mockFetchCanEdit(...args),
  addPerson: (...args: unknown[]) => mockAddPerson(...args),
  updatePerson: (...args: unknown[]) => mockUpdatePerson(...args),
  removePerson: (...args: unknown[]) => mockRemovePerson(...args),
  setDietary: (...args: unknown[]) => mockSetDietary(...args),
}));
jest.mock('@/features/auth/session', () => ({
  useAuth: () => ({ status: 'signedIn', session: { user: { id: 'user-1' } } }),
}));
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    router: { back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});

const MO: Person = {
  id: 'p-mo',
  displayName: 'Mo',
  ageBand: 'toddler',
  dueMonth: null,
  allergies: ['allergen.peanut'],
  diets: [],
};

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const show = () =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <PeopleProfilesScreen householdId="h1" locale="en-US" />
    </SafeAreaProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchPeople.mockResolvedValue([MO]);
  mockFetchCanEdit.mockResolvedValue(true);
  mockAddPerson.mockResolvedValue('p-new');
  mockUpdatePerson.mockResolvedValue(undefined);
  mockRemovePerson.mockResolvedValue(undefined);
  mockSetDietary.mockResolvedValue(undefined);
});

describe('S-28 people and allergies (FR-HH-11, FR-HH-12, FR-PAY-10)', () => {
  it('lists people with age band and allergies, and shows the disclaimer', async () => {
    await show();
    expect(await screen.findByTestId('person-0')).toHaveTextContent(/Mo.*Toddler · Peanuts/);
    expect(screen.getByTestId('people-disclaimer')).toHaveTextContent(/isn't medical advice/);
  });

  it('saves only the codes that changed, as codes', async () => {
    await show();
    await fireEvent.press(await screen.findByTestId('person-0'));
    expect(screen.getByTestId('person-disclaimer')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('person-allergen.peanut'));
    await fireEvent.press(screen.getByTestId('person-allergen.sesame'));
    await fireEvent.press(screen.getByTestId('person-save'));

    expect(mockUpdatePerson).toHaveBeenCalledWith('p-mo', {
      displayName: 'Mo',
      ageBand: 'toddler',
      dueMonth: null,
    });
    expect(mockSetDietary.mock.calls.map(([c]) => [c.code, c.on])).toEqual([
      ['allergen.sesame', true],
      ['allergen.peanut', false],
    ]);
    expect(mockFetchPeople).toHaveBeenCalledTimes(2);
  });

  it('adds an expecting person with the due month only and no codes', async () => {
    await show();
    await fireEvent.press(await screen.findByTestId('people-add'));
    await fireEvent.press(screen.getByTestId('person-save'));
    expect(screen.getByTestId('person-error')).toHaveTextContent(/name or nickname/);

    await fireEvent.changeText(screen.getByTestId('person-name'), 'Bean');
    await fireEvent.press(screen.getByTestId('person-band-expecting'));
    expect(screen.queryByTestId('person-allergen.milk')).toBeNull();
    const due = screen.getAllByTestId(/^person-due-\d{4}-\d{2}$/)[2];
    const month = due.props.testID.slice('person-due-'.length);
    await fireEvent.press(due);
    await fireEvent.press(screen.getByTestId('person-save'));
    expect(mockAddPerson).toHaveBeenCalledWith('h1', {
      displayName: 'Bean',
      ageBand: 'expecting',
      dueMonth: month,
    });
    expect(month).toMatch(/^\d{4}-\d{2}$/);
    expect(mockSetDietary).not.toHaveBeenCalled();
  });

  it('removes a person after confirming', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    await show();
    await fireEvent.press(await screen.findByTestId('person-0'));
    await fireEvent.press(screen.getByTestId('person-remove'));
    const buttons = alert.mock.calls[0][2] ?? [];
    await act(async () => buttons.find((b) => b.style === 'destructive')?.onPress?.());
    expect(mockRemovePerson).toHaveBeenCalledWith('p-mo');
  });

  it('is read-only for caregivers', async () => {
    mockFetchCanEdit.mockResolvedValue(false);
    await show();
    await fireEvent.press(await screen.findByTestId('person-0'));
    expect(screen.queryByTestId('person-sheet')).toBeNull();
    expect(screen.queryByTestId('people-add')).toBeNull();
    expect(screen.getByTestId('people-disclaimer')).toBeOnTheScreen();
  });

  it('shows a load error offline', async () => {
    mockFetchPeople.mockRejectedValue(new Error('offline'));
    await show();
    expect(await screen.findByTestId('people-load-error')).toBeOnTheScreen();
  });
});
