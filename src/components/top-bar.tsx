import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { IconButton } from '@/components/icon-button';
import { Text } from '@/components/text';
import { useTheme } from '@/hooks/use-theme';

export type TopBarAction = {
  /** Translated text action ("Edit"). */
  label: string;
  onPress: () => void;
  testID: string;
};

export type TopBarProps = {
  /** Translated screen title, in `type.screenTitle`. It wraps rather than truncates. */
  title: string;
  /** Shows a back button on the leading side. */
  onBack?: () => void;
  /** At most two trailing text actions. */
  actions?: readonly [TopBarAction] | readonly [TopBarAction, TopBarAction];
  testID: string;
};

/** Section 8 TopBar: `title`, `back` and `actions` variants. */
export function TopBar({ title, onBack, actions, testID }: TopBarProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <View
      style={[
        styles.bar,
        {
          minHeight: theme.layout.minRowHeight,
          paddingHorizontal: theme.layout.screenMargin,
          paddingTop: theme.space[2],
          paddingBottom: theme.space[2],
          gap: theme.space[1],
        },
      ]}
    >
      {onBack || actions ? (
        <View style={styles.controls}>
          {onBack ? (
            <IconButton
              icon="back"
              accessibilityLabel={t('components.topBar.back')}
              onPress={onBack}
              testID={`${testID}-back`}
              style={{ marginStart: -theme.space[3] }}
            />
          ) : (
            <View />
          )}
          {actions ? (
            <View style={[styles.actions, { gap: theme.space[1] }]}>
              {actions.map((action) => (
                <Button
                  key={action.testID}
                  variant="ghost"
                  label={action.label}
                  onPress={action.onPress}
                  testID={action.testID}
                />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
      <Text variant="screenTitle" accessibilityRole="header" testID={testID}>
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    alignItems: 'stretch',
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  actions: {
    flexDirection: 'row',
    flexShrink: 1,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
});
