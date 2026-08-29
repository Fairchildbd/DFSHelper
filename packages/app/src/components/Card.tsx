import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { radius, useStyles, useTheme, type Theme } from '../theme';

export function Card({
  children,
  wash = false,
  rail = false,
  outlined = false,
  style,
}: {
  children: React.ReactNode;
  wash?: boolean;
  rail?: boolean;
  outlined?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles(sheet);

  return (
    <View style={[styles.card, rail && styles.rail, outlined && styles.outlined, style]}>
      {wash && <CardWash />}
      {children}
    </View>
  );
}

export function CardWash({ style }: { style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <LinearGradient
      colors={t.cardWash}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0.35 }}
      style={[StyleSheet.absoluteFill, style]}
      pointerEvents="none"
    />
  );
}

const sheet = (t: Theme) => ({
  card: {
    backgroundColor: t.surface,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.border,
    overflow: 'hidden' as const,
  },
  rail: {
    borderLeftWidth: 2,
    borderLeftColor: t.accent,
  },
  outlined: {
    borderWidth: 1,
    borderColor: t.accent,
  },
});
