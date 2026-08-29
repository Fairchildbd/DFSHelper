import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { getPixels, radius, useStyles, useTheme, type Theme } from '../theme';
import { IconPuck } from './Icon';

export function Loading() {
  const t = useTheme();
  const styles = useStyles(sheet);
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={t.accent} size="large" />
    </View>
  );
}

export function ErrorState({
  title = 'Can’t reach the API',
  message,
  hint,
  onRetry,
}: {
  title?: string;
  message: string;
  hint?: React.ReactNode;
  onRetry?: () => void;
}) {
  const styles = useStyles(sheet);

  return (
    <View style={styles.centre}>
      <IconPuck name="wifi-off" size="lg" />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {onRetry && (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
        >
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      )}
    </View>
  );
}

export function Mono({ children }: { children: React.ReactNode }) {
  const styles = useStyles(sheet);
  return <Text style={styles.mono}>{children}</Text>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  const styles = useStyles(sheet);
  return <Text style={styles.empty}>{children}</Text>;
}

const sheet = (t: Theme) => ({
  loading: {
    flex: 1,
    backgroundColor: t.bg,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  centre: {
    flex: 1,
    backgroundColor: t.bg,
    justifyContent: 'center' as const,
    alignItems: 'flex-start' as const,
    padding: 28,
    gap: 10,
  },
  title: { color: t.text, fontSize: getPixels(21), fontWeight: '800' as const, marginTop: 4 },
  message: { color: t.danger, fontSize: getPixels(13), lineHeight: getPixels(19) },
  hint: { color: t.textDim, fontSize: getPixels(13), lineHeight: getPixels(20) },
  mono: {
    color: t.accent,
    fontFamily: Platform.select({ ios: 'Courier', default: 'monospace' }),
    fontSize: getPixels(12.5),
  },
  retry: {
    marginTop: 6,
    backgroundColor: t.accent,
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: radius.chip,
  },
  pressed: { opacity: 0.75 },
  retryText: { color: t.onAccent, fontWeight: '800' as const, fontSize: getPixels(14) },
  empty: {
    color: t.textDim,
    textAlign: 'center' as const,
    padding: 32,
    fontSize: getPixels(13),
  },
});
