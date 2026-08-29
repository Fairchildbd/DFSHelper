import { ScrollView, StyleSheet, Text, View, Pressable, type StyleProp, type ViewStyle } from 'react-native';
import { getPixels, radius, useStyles, useTheme, type Theme } from '../theme';
import { glowStyle } from './Icon';

export function Chip({
  label,
  count,
  active,
  onPress,
  style,
}: {
  label: string;
  count?: number | null;
  active: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const styles = useStyles(sheet);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.chip,
        active ? styles.chipActive : styles.chipIdle,
        active && glowStyle(theme, 0.7),
        pressed && styles.pressed,
        style,
      ]}
    >
      <Text style={[styles.label, active ? styles.labelActive : styles.labelIdle]}>
        {label}
      </Text>
      {count != null && (
        <View style={[styles.badge, active ? styles.badgeActive : styles.badgeIdle]}>
          <Text style={[styles.badgeText, active ? styles.badgeTextActive : styles.badgeTextIdle]}>
            {count}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

export function ChipRow({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles(sheet);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[styles.rowScroll, style]}
      contentContainerStyle={styles.row}
    >
      {children}
    </ScrollView>
  );
}

export function NumberChip({
  value,
  active,
  onPress,
}: {
  value: number;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const styles = useStyles(sheet);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.numberChip,
        active ? styles.chipActive : styles.chipIdle,
        active && glowStyle(theme, 0.7),
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.numberLabel, active ? styles.labelActive : styles.labelIdle]}>
        {value}
      </Text>
    </Pressable>
  );
}

export function Segmented<K extends string>({
  items,
  value,
  onChange,
}: {
  items: Array<{ key: K; label: string }>;
  value: K;
  onChange: (key: K) => void;
}) {
  const theme = useTheme();
  const styles = useStyles(sheet);

  return (
    <View style={styles.segmented}>
      {items.map((item) => {
        const active = item.key === value;
        return (
          <Pressable
            key={item.key}
            onPress={() => onChange(item.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={({ pressed }) => [
              styles.segment,
              active && styles.segmentActive,
              active && glowStyle(theme, 0.5),
              pressed && styles.pressed,
            ]}
          >
            <Text
              style={[styles.segmentLabel, active ? styles.segmentLabelActive : styles.labelIdle]}
              numberOfLines={1}
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const sheet = (theme: Theme) => ({
  chip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipIdle: { backgroundColor: theme.surface, borderColor: theme.border },
  chipActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  pressed: { opacity: 0.7 },

  label: { fontSize: getPixels(13), fontWeight: '600' as const },
  labelIdle: { color: theme.textDim },
  labelActive: { color: theme.onAccent, fontWeight: '700' as const },

  badge: {
    minWidth: 20,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radius.chip,
    alignItems: 'center' as const,
  },
  badgeIdle: { backgroundColor: theme.surfaceAlt },
  badgeActive: { backgroundColor: 'rgba(0, 0, 0, 0.22)' },
  badgeText: { fontSize: getPixels(11), fontWeight: '700' as const },
  badgeTextIdle: { color: theme.textFaint },
  badgeTextActive: { color: theme.onAccent },

  rowScroll: { marginHorizontal: -16, flexGrow: 0 },
  row: { flexDirection: 'row' as const, gap: 8, paddingHorizontal: 16, paddingVertical: 10 },

  numberChip: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: StyleSheet.hairlineWidth,
  },
  numberLabel: { fontSize: getPixels(14), fontWeight: '700' as const },

  segmented: {
    flexDirection: 'row' as const,
    backgroundColor: theme.surface,
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    padding: 3,
  },
  segment: {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingVertical: 9,
    paddingHorizontal: 6,
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  segmentActive: { backgroundColor: theme.accentSoft, borderColor: theme.accent },
  segmentLabel: { fontSize: getPixels(12.5), fontWeight: '600' as const },
  segmentLabelActive: { color: theme.accent, fontWeight: '700' as const },
});
