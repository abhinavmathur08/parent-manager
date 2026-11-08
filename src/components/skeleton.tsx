import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { useTheme } from '@/hooks/use-theme';

export type SkeletonProps = {
  variant?: 'row' | 'card';
  /** How many placeholders to show. */
  count?: number;
  /** Section 8: placeholders appear only after 300 ms of waiting. */
  delay?: number;
  testID: string;
  style?: StyleProp<ViewStyle>;
};

export const SKELETON_DELAY = 300;
const PULSE = 900;

/**
 * Section 8 Skeleton: `surfaceAlt` blocks shown after 300 ms of waiting. A slow pulse, which
 * stops when Reduce Motion is on (NFR-A11Y-7). Read as one "Loading" element.
 */
export function Skeleton({
  variant = 'row',
  count = 3,
  delay = SKELETON_DELAY,
  testID,
  style,
}: SkeletonProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const reduceMotion = useReduceMotion();
  const [shown, setShown] = useState(delay <= 0);
  const [opacity] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (shown) return;
    const timer = setTimeout(() => setShown(true), delay);
    return () => clearTimeout(timer);
  }, [delay, shown]);

  useEffect(() => {
    if (!shown || reduceMotion) {
      opacity.setValue(1);
      return;
    }
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.55, duration: PULSE, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: PULSE, useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [shown, reduceMotion, opacity]);

  if (!shown) return null;

  const block = { backgroundColor: theme.color.surfaceAlt, borderRadius: theme.radius.sm };
  return (
    <Animated.View
      testID={testID}
      accessible
      accessibilityLabel={t('components.skeleton.loading')}
      accessibilityState={{ busy: true }}
      style={[{ gap: theme.space[2], opacity }, style]}
    >
      {Array.from({ length: count }, (_, index) =>
        variant === 'row' ? (
          <View
            key={index}
            style={[
              styles.row,
              {
                minHeight: theme.layout.minRowHeight,
                gap: theme.space[3],
                paddingHorizontal: theme.space[4],
              },
            ]}
          >
            <View style={[block, styles.dot, { borderRadius: theme.radius.pill }]} />
            <View style={[block, styles.line]} />
          </View>
        ) : (
          <View
            key={index}
            style={[
              styles.card,
              {
                borderRadius: theme.radius.card,
                borderColor: theme.color.border,
                padding: theme.space[4],
                gap: theme.space[2],
              },
            ]}
          >
            <View style={[block, styles.title]} />
            <View style={[block, styles.cardLine]} />
          </View>
        ),
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: 26,
    height: 26,
  },
  line: {
    flex: 1,
    height: 14,
  },
  card: {
    borderWidth: 1,
  },
  cardLine: {
    alignSelf: 'stretch',
    height: 14,
  },
  title: {
    width: '60%',
    height: 20,
  },
});
