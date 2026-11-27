import { useTranslation } from 'react-i18next';

import { BottomSheet } from '@/components/bottom-sheet';
import { RadioOption } from '@/components/radio-option';
import type { Member } from '@/features/household/members';

import type { AssigneeRole } from './editor';

export type AssignSheetProps = {
  visible: boolean;
  current: string | null;
  userId: string | null;
  /** Members other than the viewer that they may assign (D-25, T4 and T5). */
  assignable: readonly Member[];
  onPick: (assigneeUserId: string | null, role: AssigneeRole) => void;
  onClose: () => void;
};

/** One tap from the row's member chip or task detail to assign a task (FR3-TASK-5). */
export function AssignSheet({
  visible,
  current,
  userId,
  assignable,
  onPick,
  onClose,
}: AssignSheetProps) {
  const { t } = useTranslation();
  const options: { id: string | null; label: string; role: AssigneeRole; testID: string }[] = [
    { id: null, label: t('tasks.editor.anyone'), role: 'none', testID: 'task-assign-anyone' },
    ...(userId
      ? [
          {
            id: userId,
            label: t('tasks.editor.me'),
            role: 'self' as const,
            testID: 'task-assign-me',
          },
        ]
      : []),
    ...assignable.map((member, i) => ({
      id: member.userId,
      label: member.displayName ?? t('tasks.assignee.member'),
      role: (member.role === 'parent' ? 'parent' : 'helper') as AssigneeRole,
      testID: `task-assign-${i}`,
    })),
  ];
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t('tasks.assign.title')}
      testID="task-assign"
    >
      {options.map((option) => (
        <RadioOption
          key={option.testID}
          label={option.label}
          selected={current === option.id}
          onPress={() => onPick(option.id, option.role)}
          testID={option.testID}
        />
      ))}
    </BottomSheet>
  );
}
