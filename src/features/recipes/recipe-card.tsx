import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { Icon } from '@/components/icon';
import { Tag } from '@/components/tag';
import { Text } from '@/components/text';
import { useTheme } from '@/hooks/use-theme';
import { formatNumber } from '@/i18n';

import type { RecipeEntry } from './search';

/**
 * A recipe on the Recipes tab (FR-REC-1): title, total time and tags. The "used in plan"
 * marker arrives with the planner (P-01.1).
 */
export function RecipeCard({
  recipe,
  locale,
  onPress,
  testID,
}: {
  recipe: RecipeEntry;
  locale: string;
  onPress: () => void;
  testID: string;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const time =
    recipe.totalMinutes === null
      ? null
      : t('recipes.card.minutes', { minutes: formatNumber(recipe.totalMinutes, locale) });
  const tags = recipe.tags.map((tag) => t(`recipes.tags.${tag.slice(4)}`));
  return (
    <Card
      onPress={onPress}
      accessibilityLabel={[recipe.title, time, ...tags].filter(Boolean).join(', ')}
      testID={testID}
    >
      <View style={{ gap: theme.space[2] }}>
        <Text variant="cardTitle">{recipe.title}</Text>
        {time ? (
          <View style={[styles.row, { gap: theme.space[1] }]}>
            <Icon name="clock" size="sm" color="textSecondary" />
            <Text variant="caption" color="textSecondary">
              {time}
            </Text>
          </View>
        ) : null}
        {tags.length ? (
          <View style={[styles.wrap, { gap: theme.space[1] }]}>
            {tags.map((label) => (
              <Tag key={label} label={label} />
            ))}
          </View>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
});
