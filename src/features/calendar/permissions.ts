import type { MemberRole } from '@/features/household/invitations';

import type { EventRow } from './tables';

/**
 * What a member may do with an event they can see (spec section 2, C4 to C6). The server
 * enforces the same rules (`private.check_event`, `private.can_edit_event`); the app only
 * hides what would be refused.
 */
export function eventPermissions(
  event: Pick<EventRow, 'created_by' | 'shared' | 'taking_user_id'>,
  role: MemberRole,
  userId: string | null,
) {
  const isParent = role === 'parent';
  const own = userId !== null && event.created_by === userId && event.shared;
  return {
    /** Edit or delete: parents always; others only the shared events they created (C4, C5). */
    canEdit: isParent || own,
    /** Share or unshare: parents only (C4). */
    canShare: isParent,
    /** Take it themselves, or step back (C6). */
    canTake: userId !== null,
    /** Pick anyone as taking: parents, and creators editing their own event. */
    canAssign: isParent || own,
  };
}
