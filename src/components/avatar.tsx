import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Text } from '@/components/text';
import type { ColorToken } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type AvatarSize = 'sm' | 'md' | 'lg';

const SIZE: Record<AvatarSize, number> = { sm: 22, md: 28, lg: 56 };
const FILLS: readonly ColorToken[] = ['avatarSand', 'avatarSage'];
const OVERLAP = 6;

/** The first letter of a display name, in the name's own case rules. Initials only, never photos. */
export function initialOf(name: string): string {
  const first = Array.from(name.trim())[0] ?? '';
  return first.toLocaleUpperCase();
}

/** Member 1 is sand, member 2 sage, and later members cycle through the two. */
export function avatarFill(memberIndex: number): ColorToken {
  return FILLS[Math.abs(memberIndex) % FILLS.length];
}

export type AvatarProps = {
  /** The member's display name. Only its initial is shown. */
  name: string;
  /** The member's position in the household, which picks the fill. */
  memberIndex: number;
  size?: AvatarSize;
  /** Translated label naming the person and the action ("checked by Alex"). Defaults to the name. */
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Section 8 Avatar (NFR-SEC-4: initials only). Light mode adds a 1.5 pt `textSecondary` ring,
 * since the fills are pale against white; dark mode uses a 2 pt `surface` ring.
 */
export function Avatar({
  name,
  memberIndex,
  size = 'md',
  accessibilityLabel,
  testID,
  style,
}: AvatarProps) {
  const theme = useTheme();
  const diameter = SIZE[size];
  const ring = theme.avatarRing;
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel ?? name}
      style={[
        styles.avatar,
        {
          width: diameter,
          height: diameter,
          borderRadius: theme.radius.pill,
          backgroundColor: theme.color[avatarFill(memberIndex)],
          borderWidth: ring.width,
          borderColor: theme.color[ring.color],
        },
        style,
      ]}
    >
      <Text
        variant={size === 'lg' ? 'sheetTitle' : 'caption'}
        color="onAvatar"
        // Initials sit inside a fixed circle, so they can't grow past it.
        maxFontSizeMultiplier={1}
        style={[styles.initial, size === 'sm' && styles.small]}
      >
        {initialOf(name)}
      </Text>
    </View>
  );
}

export type AvatarGroupProps = {
  members: readonly { name: string; memberIndex: number }[];
  size?: AvatarSize;
  /** Translated label for the whole group ("Added by Alex and Sam"). */
  accessibilityLabel: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
};

/** Avatars overlapping by 6 pt, read as one element. */
export function AvatarGroup({
  members,
  size = 'md',
  accessibilityLabel,
  testID,
  style,
}: AvatarGroupProps) {
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={[styles.group, style]}
    >
      {members.map((member, index) => (
        <Avatar
          key={`${member.memberIndex}-${index}`}
          name={member.name}
          memberIndex={member.memberIndex}
          size={size}
          style={index > 0 ? { marginStart: -OVERLAP } : null}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  initial: {
    textAlign: 'center',
    fontWeight: '600',
  },
  small: {
    fontSize: 12,
    lineHeight: 16,
  },
  group: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
