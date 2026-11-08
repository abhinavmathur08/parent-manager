import { useEffect, useEffectEvent, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Text } from '@/components/text';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { useTheme } from '@/hooks/use-theme';

export type ToastProps = {
  visible: boolean;
  /** Translated message ("Milk removed"). */
  message: string;
  /** `undo` shows an action; `info` is a message only. */
  variant?: 'undo' | 'info';
  /** Translated action label, usually "Undo". */
  actionLabel?: string;
  onAction?: () => void;
  /** Called when the toast times out or its action runs. */
  onDismiss: () => void;
  /** How long it stays, in milliseconds. */
  duration?: number;
  /** Distance from the bottom of the screen. Defaults to clearing the floating tab bar. */
  bottomOffset?: number;
  testID: string;
};

/** Section 8: toasts stay for 5 seconds. */
export const TOAST_DURATION = 5000;

/**
 * Section 8 Toast and UndoBar: above the tab bar, announced to screen readers, with a 48 pt
 * undo action. Undo replaces "are you sure?" dialogs (section 1). It fades rather than moves,
 * and appears at once with Reduce Motion on (NFR-A11Y-7).
 */
export function Toast({
  visible,
  message,
  variant = 'info',
  actionLabel,
  onAction,
  onDismiss,
  duration = TOAST_DURATION,
  bottomOffset,
  testID,
}: ToastProps) {
  const theme = useTheme();
  const reduceMotion = useReduceMotion();
  const [opacity] = useState(() => new Animated.Value(0));
  const dismiss = useEffectEvent(onDismiss);

  useEffect(() => {
    if (!visible) return;
    AccessibilityInfo.announceForAccessibility(message);
    const timer = setTimeout(() => dismiss(), duration);
    return () => clearTimeout(timer);
  }, [visible, message, duration]);

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: reduceMotion ? 0 : theme.motion.fast,
      useNativeDriver: true,
    }).start();
  }, [visible, reduceMotion, opacity, theme.motion.fast]);

  if (!visible) return null;

  return (
    <Animated.View
      testID={testID}
      accessibilityLiveRegion="polite"
      style={[
        styles.toast,
        theme.elevation.floating,
        {
          opacity,
          start: theme.layout.screenMargin,
          end: theme.layout.screenMargin,
          bottom: bottomOffset ?? theme.layout.tabBarClearance,
          borderRadius: theme.radius.card,
          borderColor: theme.color.border,
          backgroundColor: theme.color.surface,
          paddingStart: theme.space[4],
          paddingEnd: theme.space[1],
          paddingVertical: theme.space[1],
          gap: theme.space[2],
        },
      ]}
    >
      <View style={[styles.message, { paddingVertical: theme.space[3] }]}>
        <Text>{message}</Text>
      </View>
      {variant === 'undo' && actionLabel && onAction ? (
        <Button
          variant="ghost"
          label={actionLabel}
          onPress={() => {
            onAction();
            onDismiss();
          }}
          testID={`${testID}-action`}
        />
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
  },
  message: {
    flex: 1,
  },
});
