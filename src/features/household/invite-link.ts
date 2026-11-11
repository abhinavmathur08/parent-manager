/**
 * The web address invite links use, such as `https://example.com`. Links need the product
 * domain (decision D-2), so until EXPO_PUBLIC_INVITE_LINK_BASE is set, invites share the
 * code only. Expo inlines EXPO_PUBLIC_* only in this exact dotted form.
 */
export function parseInviteLinkBase(value: string | undefined): string | null {
  const trimmed = value?.trim().replace(/\/+$/, '');
  return trimmed && /^https:\/\/[^\s/]+(\/\S*)?$/.test(trimmed) ? trimmed : null;
}

const LINK_BASE = parseInviteLinkBase(process.env.EXPO_PUBLIC_INVITE_LINK_BASE);

/** The invite link for a token (FR-HH-2), or null while there's no link domain. */
export function inviteLink(token: string, base: string | null = LINK_BASE): string | null {
  return base ? `${base}/invite/${encodeURIComponent(token)}` : null;
}
