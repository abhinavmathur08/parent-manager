import { messageKey, messageValues, routeFor } from '@/features/notifications/inbox';

jest.mock('@/lib/supabase', () => ({ getSupabase: jest.fn() }));

describe('"assigned to you" (FR3-NOT-3)', () => {
  const one = { type: 'task_assigned' as const, payload: { task_ids: ['t1'] } };
  const many = { type: 'task_assigned' as const, payload: { task_ids: ['t1', 't2'] } };

  it('has fixed text with no values', () => {
    expect(messageKey(one)).toBe('task_assigned');
    expect(messageValues(many, (k) => k, 'en-US')).toEqual({});
  });

  it('opens the task when the batch names one, else the Tasks tab', () => {
    expect(routeFor('task_assigned', one.payload)).toEqual({
      pathname: '/tasks/[id]',
      params: { id: 't1' },
    });
    // A push names its one task as `task_id`.
    expect(routeFor('task_assigned', { task_id: 't1' })).toEqual({
      pathname: '/tasks/[id]',
      params: { id: 't1' },
    });
    expect(routeFor('task_assigned', many.payload)).toBe('/tasks');
    expect(routeFor('task_assigned', {})).toBe('/tasks');
  });
});
