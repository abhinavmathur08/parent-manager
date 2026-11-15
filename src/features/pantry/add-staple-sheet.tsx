import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { ListRow } from '@/components/list-row';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { searchIngredients } from '@/features/ingredients/matching';
import type { Ingredients } from '@/features/ingredients/use-ingredients';
import { useTheme } from '@/hooks/use-theme';

const MAX_SUGGESTIONS = 6;

/**
 * Adding a staple from S-22 (FR-PAN-2): search the catalog and the household's own
 * ingredients by name or synonym in the locale, and tap one. Matches are IDs, never
 * compared as display text (R-ING-6).
 */
export function AddStapleSheet({
  visible,
  ingredients,
  staples,
  onAdd,
  onClose,
}: {
  visible: boolean;
  ingredients: Ingredients;
  /** Ingredient IDs that are staples already, shown as such. */
  staples: ReadonlySet<string>;
  onAdd: (ingredientId: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [text, setText] = useState('');
  const suggestions = useMemo(
    () =>
      text.trim() ? searchIngredients(ingredients.index, text, { limit: MAX_SUGGESTIONS }) : [],
    [ingredients.index, text],
  );
  const close = () => {
    setText('');
    onClose();
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      title={t('pantry.add.title')}
      variant="form"
      testID="pantry-add-sheet"
    >
      <View style={{ gap: theme.space[2] }}>
        <TextField
          variant="search"
          accessibilityLabel={t('pantry.add.search')}
          placeholder={t('pantry.add.search')}
          value={text}
          onChangeText={setText}
          autoCorrect={false}
          autoFocus
          testID="pantry-add-search"
        />
        {suggestions.map((result, i) => {
          const already = staples.has(result.ingredientId);
          return (
            <ListRow
              key={result.ingredientId}
              title={result.displayName}
              subtitle={already ? t('pantry.add.already') : undefined}
              disabled={already}
              onPress={() => {
                setText('');
                onAdd(result.ingredientId);
              }}
              divider={i < suggestions.length - 1}
              testID={`pantry-add-suggestion-${i}`}
            />
          );
        })}
        {text.trim() && !suggestions.length ? (
          <Text color="textSecondary" testID="pantry-add-none">
            {t('pantry.add.none')}
          </Text>
        ) : null}
      </View>
    </BottomSheet>
  );
}
