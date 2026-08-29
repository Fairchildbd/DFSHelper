import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from '../i18n';
import { getPixels, radius, useStyles, useTheme, type Theme } from '../theme';
import { IconPuck } from './Icon';

export function Loading() {
  const theme = useTheme();
  const styles = useStyles(sheet);
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={theme.accent} size="large" />
    </View>
  );
}

export function ErrorState({
  title,
  message,
  hint,
  onRetry,
}: {
  title?: string;
  message: string;
  hint?: React.ReactNode;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  const styles = useStyles(sheet);

  return (
    <View style={styles.centre}>
      <IconPuck name="wifi-off" size="lg" />
      <Text style={styles.title}>{title ?? t('error.unreachableTitle')}</Text>
      <Text style={styles.message}>{message}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {onRetry && (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
        >
          <Text style={styles.retryText}>{t('error.retry')}</Text>
        </Pressable>
      )}
    </View>
  );
}

export function Mono({ children }: { children?: React.ReactNode }) {
  const styles = useStyles(sheet);
  return <Text style={styles.mono}>{children}</Text>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  const styles = useStyles(sheet);
  return <Text style={styles.empty}>{children}</Text>;
}

const sheet = (theme: Theme) => ({
  loading: {
    flex: 1,
    backgroundColor: theme.bg,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  centre: {
    flex: 1,
    backgroundColor: theme.bg,
    justifyContent: 'center' as const,
    alignItems: 'flex-start' as const,
    padding: 28,
    gap: 10,
  },
  title: { color: theme.text, fontSize: getPixels(21), fontWeight: '800' as const, marginTop: 4 },
  message: { color: theme.danger, fontSize: getPixels(13), lineHeight: getPixels(19) },
  hint: { color: theme.textDim, fontSize: getPixels(13), lineHeight: getPixels(20) },
  mono: {
    color: theme.accent,
    fontFamily: Platform.select({ ios: 'Courier', default: 'monospace' }),
    fontSize: getPixels(12.5),
  },
  retry: {
    marginTop: 6,
    backgroundColor: theme.accent,
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: radius.chip,
  },
  pressed: { opacity: 0.75 },
  retryText: { color: theme.onAccent, fontWeight: '800' as const, fontSize: getPixels(14) },
  empty: {
    color: theme.textDim,
    textAlign: 'center' as const,
    padding: 32,
    fontSize: getPixels(13),
  },
});
