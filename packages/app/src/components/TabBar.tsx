import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getPixels, radius, useStyles, useTheme, type Theme } from '../theme';
import { Glass } from './Glass';
import { Icon, glowStyle, type IconName } from './Icon';

export interface TabItem<K extends string> {
  key: K;
  label: string;
  icon: IconName;
}

const PILL_HEIGHT = 62;
const SIDE_MARGIN = 14;
const PILL_RADIUS = 26;

function bottomOffset(safeAreaBottom: number): number {
  return safeAreaBottom > 0 ? Math.max(safeAreaBottom - 8, 8) : 12;
}

export function tabBarSpace(safeAreaBottom: number): number {
  return PILL_HEIGHT + bottomOffset(safeAreaBottom) + 10;
}

export function TabBar<K extends string>({
  items,
  value,
  onChange,
}: {
  items: ReadonlyArray<TabItem<K>>;
  value: K;
  onChange: (key: K) => void;
}) {
  const t = useTheme();
  const styles = useStyles(sheet);
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[styles.dock, { paddingBottom: bottomOffset(insets.bottom) }]}
      pointerEvents="box-none"
    >
      <View style={styles.pillLift}>
        <Glass radius={PILL_RADIUS} style={styles.pill}>
          <View style={styles.row}>
            {items.map((item) => {
              const active = item.key === value;
              return (
                <Pressable
                  key={item.key}
                  onPress={() => onChange(item.key)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={item.label}
                  style={({ pressed }) => [
                    styles.tab,
                    active && styles.tabActive,
                    active && glowStyle(t, 0.55),
                    pressed && styles.pressed,
                  ]}
                >
                  <Icon name={item.icon} size={21} color={active ? t.accent : t.textDim} />
                  <Text style={[styles.label, active ? styles.labelActive : styles.labelIdle]}>
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Glass>
      </View>
    </View>
  );
}

const sheet = (t: Theme) => ({
  dock: {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: SIDE_MARGIN,
  },
  pill: { height: PILL_HEIGHT },
  pillLift: {
    borderRadius: PILL_RADIUS,

    ...Platform.select({
      android: { elevation: 8, backgroundColor: t.bgElevated },
      default: {},
    }),
  },
  row: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'stretch' as const,
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  tab: {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 3,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  tabActive: { backgroundColor: t.accentSoft, borderColor: t.accent },
  pressed: { opacity: 0.65 },
  label: { fontSize: getPixels(11), fontWeight: '600' as const },
  labelIdle: { color: t.textDim },
  labelActive: { color: t.accent, fontWeight: '700' as const },
});
