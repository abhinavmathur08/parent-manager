// Initialize i18next once for every test, as the app does at startup.
import '@/i18n';

// expo-notifications has no native module under Jest, and expo-router listens for notification
// taps once it's installed. Tests that need particular behaviour mock it again themselves.
jest.mock('expo-notifications', () => {
  const subscription = () => ({ remove: () => undefined });
  return {
    IosAuthorizationStatus: {
      NOT_DETERMINED: 0,
      DENIED: 1,
      AUTHORIZED: 2,
      PROVISIONAL: 3,
      EPHEMERAL: 4,
    },
    AndroidImportance: { DEFAULT: 3 },
    SchedulableTriggerInputTypes: { DATE: 'date' },
    DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
    setNotificationHandler: jest.fn(),
    getPermissionsAsync: jest.fn(async () => ({
      status: 'undetermined',
      granted: false,
      canAskAgain: true,
      expires: 'never',
    })),
    requestPermissionsAsync: jest.fn(),
    getExpoPushTokenAsync: jest.fn(),
    setNotificationChannelAsync: jest.fn(),
    setNotificationCategoryAsync: jest.fn(),
    scheduleNotificationAsync: jest.fn(async () => 'id'),
    cancelScheduledNotificationAsync: jest.fn(),
    getAllScheduledNotificationsAsync: jest.fn(async () => []),
    getLastNotificationResponseAsync: jest.fn(async () => null),
    getLastNotificationResponse: jest.fn(() => null),
    clearLastNotificationResponseAsync: jest.fn(),
    clearLastNotificationResponse: jest.fn(),
    useLastNotificationResponse: jest.fn(() => null),
    addPushTokenListener: jest.fn(subscription),
    addNotificationReceivedListener: jest.fn(subscription),
    addNotificationResponseReceivedListener: jest.fn(subscription),
  };
});
