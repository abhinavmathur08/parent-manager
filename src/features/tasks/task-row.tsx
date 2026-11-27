import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { Chip } from '@/components/chip';
import { CheckboxMark } from '@/components/checkbox';
import { Text } from '@/components/text';
import { useTheme } from '@/hooks/use-theme';

export type TaskRowProps = {
  title: string;
  /** The due label shown, or null for Anytime or under a day's heading. */
  due: string | null;
  /** The due label read out, even under a day's heading. */
  spokenDue: string | null;
  /** "For Sam", "For you", or null when anyone can do it. */
  assignee: string | null;
  done: boolean;
  repeats: boolean;
  /** The member chip's label: who it's for, or "Anyone". */
  chipLabel: string;
  onToggle: () => void;
  /** Opens task detail (S-46). */
  onOpen?: () => void;
  /** The member chip (FR3-TASK-5); null when the viewer can't assign it. */
  onAssign: (() => void) | null;
  /** "I'll do it" on a shared task with no assignee (FR3-TASK-5). */
  onTake: (() => void) | null;
  onDelete: (() => void) | null;
  testID: string;
};

/**
 * A task row (S-44, NFR3-A11Y-1): a 48 pt check target that completes in one tap (FR3-TASK-4),
 * the title and details, and the member chip or "I'll do it". Screen readers hear the title, due,
 * assignee, state and "repeats", and get complete, assign and delete as actions, not only taps.
 * Done shows a filled check, strikethrough and "Done", never color alone.
 */
export function TaskRow({
  title,
  due,
  spokenDue,
  assignee,
  done,
  repeats,
  chipLabel,
  onToggle,
  onOpen,
  onAssign,
  onTake,
  onDelete,
  testID,
}: TaskRowProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const details = [due, assignee, done ? t('tasks.row.done') : null].filter(
    (part): part is string => part !== null,
  );
  const spoken = [
    title,
    spokenDue,
    assignee ?? t('tasks.row.anyone'),
    done ? t('tasks.row.done') : t('tasks.row.open'),
    repeats ? t('tasks.row.repeats') : null,
  ].filter((part): part is string => part !== null);
  const actions = [
    { name: 'toggle', label: t(done ? 'tasks.actions.reopen' : 'tasks.actions.complete') },
    ...(onAssign ? [{ name: 'assign', label: t('tasks.actions.assign') }] : []),
    ...(onTake ? [{ name: 'take', label: t('tasks.actions.take') }] : []),
    ...(onDelete ? [{ name: 'delete', label: t('tasks.actions.delete') }] : []),
  ];

  return (
    <View
      style={[
        styles.row,
        {
          minHeight: theme.layout.minRowHeight,
          paddingVertical: theme.space[1],
          gap: theme.space[2],
          borderBottomColor: theme.color.border,
        },
      ]}
    >
      <Pressable
        onPress={onToggle}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        accessibilityLabel={t(done ? 'tasks.actions.reopenTitle' : 'tasks.actions.completeTitle', {
          title,
        })}
        hitSlop={4}
        style={[styles.check, { width: theme.layout.minTarget, height: theme.layout.minTarget }]}
        testID={`${testID}-check`}
      >
        <CheckboxMark checked={done} />
      </Pressable>
      <Pressable
        onPress={onOpen}
        disabled={!onOpen}
        accessibilityRole={onOpen ? 'button' : undefined}
        accessibilityLabel={spoken.join(', ')}
        accessibilityActions={actions}
        onAccessibilityAction={(event) => {
          const name = event.nativeEvent.actionName;
          if (name === 'toggle') onToggle();
          else if (name === 'assign') onAssign?.();
          else if (name === 'take') onTake?.();
          else if (name === 'delete') onDelete?.();
        }}
        style={styles.text}
        testID={testID}
      >
        <Text
          color={done ? 'textSecondary' : 'text'}
          style={done ? styles.struck : null}
          testID={`${testID}-title`}
        >
          {title}
        </Text>
        {details.length ? (
          <Text variant="label" color="textSecondary">
            {details.join(t('tasks.row.separator'))}
          </Text>
        ) : null}
      </Pressable>
      {onTake ? (
        <Chip
          variant="action"
          label={t('tasks.actions.take')}
          onPress={onTake}
          testID={`${testID}-take`}
        />
      ) : onAssign ? (
        <Chip variant="action" label={chipLabel} onPress={onAssign} testID={`${testID}-assign`} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  check: { alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, minWidth: 160 },
  struck: { textDecorationLine: 'line-through' },
});
