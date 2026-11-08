import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { useTheme } from '@/hooks/use-theme';

export type AllergenNoticeProps = {
  /** Translated allergen name or names, already joined with the locale's list format. */
  allergen: string;
  /** The person or people with the allergy, already joined with the locale's list format. */
  person: string;
  /**
   * `recipe` sits on the recipe detail screen (FR-REC-9), `importReview` at the top of the
   * import review (FR-AI-7), and `inline` on plan entries and list items (AI-12).
   */
  variant?: 'recipe' | 'importReview' | 'inline';
  testID: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Section 8 AllergenNotice: a `warning` outline with an icon and text naming the allergen and
 * the person. It always includes the not-medical-advice disclaimer (AI-14), which callers
 * can't remove, and it can't be dismissed. Free on every plan.
 */
export function AllergenNotice({
  allergen,
  person,
  variant = 'recipe',
  testID,
  style,
}: AllergenNoticeProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const inline = variant === 'inline';
  const message = t(
    variant === 'importReview'
      ? 'components.allergenNotice.importReview'
      : 'components.allergenNotice.message',
    { allergen, person },
  );
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole={inline ? undefined : 'alert'}
      style={[
        {
          borderWidth: 1.5,
          borderColor: theme.color.warning,
          borderRadius: inline ? theme.radius.sm : theme.radius.card,
          backgroundColor: theme.color.surface,
          padding: inline ? theme.space[2] : theme.space[4],
          gap: theme.space[1],
        },
        style,
      ]}
    >
      <View style={[styles.row, { gap: theme.space[2] }]}>
        <Icon name="warning" size={inline ? 'sm' : 'md'} color="warning" />
        <Text
          variant={inline ? 'label' : 'bodyStrong'}
          color="warning"
          style={styles.message}
          testID={`${testID}-message`}
        >
          {message}
        </Text>
      </View>
      <Text variant="caption" color="textSecondary" testID={`${testID}-disclaimer`}>
        {t('components.allergenNotice.disclaimer')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  message: {
    flex: 1,
  },
});
