import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AllergenNotice } from '@/components/allergen-notice';
import { BottomSheet } from '@/components/bottom-sheet';
import { ListRow } from '@/components/list-row';
import { Text } from '@/components/text';
import { useTheme } from '@/hooks/use-theme';
import { formatList, type AppLocale } from '@/i18n';
import type { AllergenMatch } from '@/features/recipes/scale';

import type { EasyCandidate } from './easy-dinner';

export type ShownCandidate = {
  candidate: EasyCandidate;
  title: string;
  /** Allergens in it for people in the household (FR2-BUSY-6, AI-11, AI-12). */
  allergens: AllergenMatch[];
};

/**
 * S-43, the easy dinner sheet (FR2-BUSY-2): up to 5 easy meals for a busy day, leftovers first.
 * One tap applies, with an undo bar afterwards; nothing changes before the tap (FR2-BUSY-3).
 */
export function EasyDinnerSheet({
  mode,
  candidates,
  locale,
  onApply,
  onClose,
}: {
  /** Closed when null. */
  mode: 'add' | 'swap' | null;
  candidates: readonly ShownCandidate[];
  locale: AppLocale;
  onApply: (candidate: EasyCandidate) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <BottomSheet
      visible={mode !== null}
      onClose={onClose}
      title={t(mode === 'swap' ? 'busy.easy.swapTitle' : 'busy.easy.addTitle')}
      testID="easy-dinner-sheet"
    >
      <View style={{ gap: theme.space[3] }}>
        {candidates.length === 0 ? (
          <Text color="textSecondary" testID="easy-dinner-none">
            {t('busy.easy.none')}
          </Text>
        ) : (
          candidates.map(({ candidate, title, allergens }, i) => (
            <View key={candidate.key} style={{ gap: theme.space[1] }}>
              <ListRow
                title={title}
                subtitle={t(`busy.easy.source.${candidate.source}`)}
                onPress={() => onApply(candidate)}
                divider
                testID={`easy-dinner-${i}`}
              />
              {allergens.map((match) => (
                <AllergenNotice
                  key={match.allergen}
                  variant="inline"
                  allergen={t(`allergens.${match.allergen.slice('allergen.'.length)}`)}
                  person={formatList(match.people, locale)}
                  testID={`easy-dinner-${i}-allergen-${match.allergen.slice('allergen.'.length)}`}
                />
              ))}
            </View>
          ))
        )}
      </View>
    </BottomSheet>
  );
}
