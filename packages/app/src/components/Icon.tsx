import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { radius, useTheme, type Theme } from '../theme';

export type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

export const LANE_ICONS: Record<string, IconName> = {
  qb_pass: 'football',
  wr: 'run-fast',
  te: 'human-handsup',
  rb_rush: 'shoe-cleat',
  rb_recv: 'target',
  ol_pass_pro: 'shield-outline',
};

export function laneIcon(lane: string | null | undefined): IconName {
  return (lane && LANE_ICONS[lane]) || 'chart-timeline-variant';
}

export function Icon({
  name,
  size = 18,
  color,
  style,
}: {
  name: IconName;
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <MaterialCommunityIcons
      name={name}
      size={size}
      color={color ?? t.text}
      style={style}

      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}

export function IconPuck({
  name,
  size = 'md',
  color,
  round = false,
  style,
}: {
  name: IconName;
  size?: 'sm' | 'md' | 'lg';
  color?: string;
  round?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const box = size === 'sm' ? 28 : size === 'lg' ? 48 : 36;
  const glyph = size === 'sm' ? 15 : size === 'lg' ? 24 : 19;

  return (
    <View
      style={[
        {
          width: box,
          height: box,
          borderRadius: round ? box / 2 : radius.puck,
          backgroundColor: t.accentSoft,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: t.accent,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <Icon name={name} size={glyph} color={color ?? t.accent} />
    </View>
  );
}

export function glowStyle(t: Theme, strength = 1): ViewStyle {
  return {
    shadowColor: t.glow.shadowColor,
    shadowOpacity: t.glow.shadowOpacity * strength,
    shadowRadius: t.glow.shadowRadius * strength,
    shadowOffset: t.glow.shadowOffset,

    elevation: t.mode === 'light' ? 2 : 0,
  };
}
