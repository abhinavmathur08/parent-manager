import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { ListRow } from '@/components/list-row';
import { useTheme } from '@/hooks/use-theme';

/**
 * The list's collapsed "assumed at home" row (FR-PAN-3): how many staples this week's plan
 * uses, and, expanded, each one with a single tap to put it on this week's list (R-PAN-3).
 */
export function AssumedAtHome({
  staples,
  onAdd,
}: {
  staples: readonly { ingredientId: string; name: string }[];
  onAdd: (ingredientId: string) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  if (!staples.length) return null;

  return (
    <View testID="list-assumed">
      <ListRow
        title={t('pantry.assumed.title')}
        variant="value"
        value={t('list.count', { count: staples.length })}
        accessibilityHint={open ? t('pantry.assumed.hide') : t('pantry.assumed.show')}
        onPress={() => setOpen((value) => !value)}
        testID="list-assumed-toggle"
      />
      {open ? (
        <View
          style={[
            styles.group,
            { borderRadius: theme.radius.card, borderColor: theme.color.border },
          ]}
        >
          {staples.map((staple, i) => (
            <ListRow
              key={staple.ingredientId}
              title={staple.name}
              subtitle={t('pantry.assumed.add')}
              accessibilityHint={t('pantry.assumed.addHint', { name: staple.name })}
              onPress={() => onAdd(staple.ingredientId)}
              divider={i < staples.length - 1}
              testID={`list-assumed-item-${i}`}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
});
