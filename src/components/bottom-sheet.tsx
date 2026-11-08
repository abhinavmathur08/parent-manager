import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/icon-button';
import { Text } from '@/components/text';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { useTheme } from '@/hooks/use-theme';

export type BottomSheetProps = {
  visible: boolean;
  /** Called on a scrim tap, a drag down, the close button or Android back. No confirmation. */
  onClose: () => void;
  /** Translated title, in `type.sheetTitle`. */
  title: string;
  children: ReactNode;
  /** The sheet's primary action, pinned at the bottom. */
  footer?: ReactNode;
  /** `form` lifts the sheet above the keyboard. */
  variant?: 'content' | 'form';
  testID: string;
};

/** How far, in points, a drag must travel before release closes the sheet. */
export const DISMISS_DISTANCE = 96;
const DISMISS_VELOCITY = 1.2;
const OFFSCREEN = 800;

/** Whether a drag released at this distance and speed should close the sheet. */
export function shouldDismiss(dy: number, vy: number): boolean {
  return dy > DISMISS_DISTANCE || vy > DISMISS_VELOCITY;
}

/**
 * Section 8 BottomSheet: a grabber, a title and `radius.sheet` corners over `color.scrim`.
 *
 * It stays mounted while open, so its content keeps its state when the app is backgrounded.
 * Forms that must also survive the OS killing the app keep their values in `useDraftState`
 * (NFR-A11Y-8). With Reduce Motion on, it fades instead of sliding (NFR-A11Y-7).
 */
export function BottomSheet({
  visible,
  onClose,
  title,
  children,
  footer,
  variant = 'content',
  testID,
}: BottomSheetProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const [mounted, setMounted] = useState(visible);
  const [progress] = useState(() => new Animated.Value(visible ? 1 : 0));
  const [drag] = useState(() => new Animated.Value(0));

  // Mount as soon as the sheet opens; unmount only after the closing animation.
  if (visible && !mounted) setMounted(true);

  useEffect(() => {
    drag.setValue(0);
    const [x1, y1, x2, y2] = visible ? theme.motion.easing.standard : theme.motion.easing.exit;
    const animation = Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: reduceMotion ? theme.motion.fast : theme.motion.base,
      easing: Easing.bezier(x1, y1, x2, y2),
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished && !visible) setMounted(false);
    });
    return () => animation.stop();
  }, [visible, reduceMotion, progress, drag, theme.motion]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          gesture.dy > 4 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_event, gesture) => drag.setValue(Math.max(0, gesture.dy)),
        onPanResponderRelease: (_event, gesture) => {
          if (shouldDismiss(gesture.dy, gesture.vy)) {
            onClose();
          } else {
            Animated.timing(drag, {
              toValue: 0,
              duration: theme.motion.fast,
              useNativeDriver: true,
            }).start();
          }
        },
        onPanResponderTerminate: () => drag.setValue(0),
      }),
    [drag, onClose, theme.motion.fast],
  );

  const slide = reduceMotion
    ? drag
    : Animated.add(drag, progress.interpolate({ inputRange: [0, 1], outputRange: [OFFSCREEN, 0] }));

  if (!mounted) return null;

  const sheet = (
    <Animated.View
      testID={testID}
      accessibilityViewIsModal
      style={[
        styles.sheet,
        theme.elevation.sheet,
        {
          backgroundColor: theme.color.surface,
          borderTopStartRadius: theme.radius.sheet,
          borderTopEndRadius: theme.radius.sheet,
          paddingBottom: Math.max(insets.bottom, theme.space[4]),
          opacity: reduceMotion ? progress : 1,
          transform: [{ translateY: slide }],
        },
      ]}
    >
      <View {...panResponder.panHandlers} testID={`${testID}-header`}>
        <View
          style={[
            styles.grabber,
            {
              backgroundColor: theme.color.border,
              borderRadius: theme.radius.pill,
              marginTop: theme.space[2],
            },
          ]}
        />
        <View
          style={[
            styles.header,
            { paddingStart: theme.space[4], paddingEnd: theme.space[2], gap: theme.space[2] },
          ]}
        >
          <Text variant="sheetTitle" accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
          <IconButton
            icon="close"
            color="textSecondary"
            accessibilityLabel={t('components.bottomSheet.close')}
            onPress={onClose}
            testID={`${testID}-close`}
          />
        </View>
      </View>
      <ScrollView
        style={styles.body}
        contentContainerStyle={{ paddingHorizontal: theme.space[4], paddingBottom: theme.space[4] }}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
      {footer ? (
        <View style={{ paddingHorizontal: theme.space[4], paddingTop: theme.space[2] }}>
          {footer}
        </View>
      ) : null}
    </Animated.View>
  );

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: theme.color.scrim, opacity: progress },
          ]}
        >
          <Pressable
            testID={`${testID}-scrim`}
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            accessible={false}
            importantForAccessibility="no"
          />
        </Animated.View>
        {variant === 'form' ? (
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            {sheet}
          </KeyboardAvoidingView>
        ) : (
          sheet
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '92%',
  },
  grabber: {
    width: 36,
    height: 5,
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
  },
  title: {
    flex: 1,
  },
  body: {
    flexGrow: 0,
  },
});
