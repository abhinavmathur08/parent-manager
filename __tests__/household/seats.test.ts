import { inviteLink, parseInviteLinkBase } from '@/features/household/invite-link';
import { roleAvailability } from '@/features/household/seats';

describe('seat rules (FR-HH-1)', () => {
  it('allows a second parent but not a third', () => {
    expect(roleAvailability({ parents: 1, premium: false }, 'parent')).toBe('available');
    expect(roleAvailability({ parents: 2, premium: true }, 'parent')).toBe('seat_limit');
  });

  it('needs Premium for family members and caregivers', () => {
    expect(roleAvailability({ parents: 1, premium: false }, 'caregiver')).toBe('premium_required');
    expect(roleAvailability({ parents: 1, premium: true }, 'family')).toBe('available');
  });
});

describe('invite links (D-2 interim)', () => {
  it('builds a link only when a https base is configured', () => {
    expect(parseInviteLinkBase(undefined)).toBeNull();
    expect(parseInviteLinkBase('http://example.com')).toBeNull();
    expect(parseInviteLinkBase(' https://example.com/ ')).toBe('https://example.com');
    expect(inviteLink('a b', 'https://example.com')).toBe('https://example.com/invite/a%20b');
    expect(inviteLink('tok', null)).toBeNull();
  });
});
