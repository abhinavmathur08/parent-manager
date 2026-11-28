import { dayLabel, dueLabel, taskTitle } from '@/features/tasks/labels';
import { i18n } from '@/i18n';

const t = i18n.t.bind(i18n);
const today = '2026-11-18';

describe('task labels (NFR3-L10N-1, R3-TASK-2)', () => {
  it('names nearby days in words and others as a short date', () => {
    expect(dayLabel('2026-11-19', today, 'en-US')).toBe('Tomorrow');
    expect(dayLabel('2026-11-20', today, 'en-US')).toBe('Fri, Nov 20');
    expect(dayLabel('2026-11-20', today, 'en-GB')).toBe('Fri 20 Nov');
  });

  it("adds a due time on the household's clock", () => {
    const options = { today, locale: 'en-US', timeZone: 'America/New_York', t };
    expect(dueLabel({ due_at: '2026-11-18T22:30:00Z' }, '2026-11-18', options)).toBe(
      'Today, 5:30 PM',
    );
    expect(dueLabel({ due_at: null }, '2026-11-17', options)).toBe('Yesterday');
    expect(dueLabel({ due_at: null }, null, options)).toBeNull();
  });

  it("uses the member's title, or a checklist item's text by its ID", () => {
    expect(taskTitle({ title: 'Fix the gate', template_item_id: null }, t)).toBe('Fix the gate');
    expect(taskTitle({ title: null, template_item_id: 'checklist_item.test.unknown' }, t)).toBe(
      'Task',
    );
  });
});
