import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { getPixels, useStyles, useTheme, type Theme } from '../theme';
import { Icon, glowStyle, type IconName } from './Icon';

export function Wordmark({ style }: { style?: StyleProp<ViewStyle> }) {
  const styles = useStyles(sheet);
  return (
    <View style={style}>
      <Text style={styles.wordmark} accessibilityRole="header">
        DFS<Text style={styles.wordmarkAccent}>matchup</Text>
      </Text>
    </View>
  );
}

export function RoundButton({
  name,
  onPress,
  tone = 'accent',
  label,
}: {
  name: IconName;
  onPress?: () => void;
  tone?: 'accent' | 'neutral';
  label?: string;
}) {
  const t = useTheme();
  const styles = useStyles(sheet);
  const accent = tone === 'accent';

  const body = (
    <View
      style={[
        styles.round,
        accent ? styles.roundAccent : styles.roundNeutral,
        accent && glowStyle(t, 0.6),
      ]}
    >
      <Icon name={name} size={19} color={accent ? t.accent : t.text} />
    </View>
  );

  if (!onPress) return body;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => pressed && styles.pressed}
    >
      {body}
    </Pressable>
  );
}

export function AppBar({
  onBack,
  backLabel,
  title,
  right,
}: {
  onBack?: () => void;

  backLabel?: string;

  title?: string;
  right?: React.ReactNode;
}) {
  const t = useTheme();
  const styles = useStyles(sheet);
  const centred = Boolean(onBack) && !backLabel;

  return (
    <View style={styles.bar}>
      {onBack != null && (
        <View style={styles.barSide}>
          {backLabel ? (
            <Pressable
              onPress={onBack}
              hitSlop={8}
              accessibilityRole="button"
              style={({ pressed }) => pressed && styles.pressed}
            >
              <View style={styles.backLink}>
                <Icon name="chevron-left" size={18} color={t.accent} />
                <Text style={styles.backLinkText}>{backLabel}</Text>
              </View>
            </Pressable>
          ) : (
            <RoundButton name="chevron-left" tone="neutral" onPress={onBack} label="Back" />
          )}
        </View>
      )}
      <View style={[styles.barCentre, centred ? styles.barCentred : styles.barLeading]}>
        {title ? (
          <Text style={styles.barTitle} numberOfLines={1}>
            {title}
          </Text>
        ) : backLabel ? null : (
          <Wordmark />
        )}
      </View>
      <View style={[styles.barSide, styles.barSideEnd]}>{right}</View>
    </View>
  );
}

export function PageTitle({
  title,
  subtitle,
  right,
  style,
}: {
  title: string;
  subtitle?: string | null;
  right?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles(sheet);
  return (
    <View style={[styles.titleBlock, style]}>
      <View style={styles.titleRow}>
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        {right}
      </View>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function SectionTitle({
  title,
  hint,
  right,
}: {
  title: string;
  hint?: string;
  right?: React.ReactNode;
}) {
  const styles = useStyles(sheet);
  return (
    <View style={styles.sectionBlock}>
      <View style={styles.titleRow}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {right}
      </View>
      {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
    </View>
  );
}

export function Eyebrow({ children, color }: { children: React.ReactNode; color?: string }) {
  const styles = useStyles(sheet);
  return <Text style={[styles.eyebrow, color != null && { color }]}>{children}</Text>;
}

const sheet = (t: Theme) => ({
  wordmark: {
    color: t.text,
    fontSize: getPixels(19),
    fontWeight: '800' as const,
    letterSpacing: -0.3,
  },
  wordmarkAccent: { color: t.accent, fontStyle: 'italic' as const },

  round: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: StyleSheet.hairlineWidth,
  },
  roundAccent: { backgroundColor: t.accentSoft, borderColor: t.accent },
  roundNeutral: { backgroundColor: t.surfaceAlt, borderColor: t.border },
  pressed: { opacity: 0.6 },

  backLink: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 1 },
  backLinkText: { color: t.accent, fontSize: getPixels(15), fontWeight: '600' as const },

  bar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 8,
    gap: 10,
  },
  barSide: { minWidth: 38, justifyContent: 'center' as const },
  barSideEnd: { alignItems: 'flex-end' as const },
  barCentre: { flex: 1 },
  barCentred: { alignItems: 'center' as const },
  barLeading: { alignItems: 'flex-start' as const },
  barTitle: {
    color: t.text,
    fontSize: getPixels(17),
    fontWeight: '700' as const,
    letterSpacing: -0.2,
  },

  titleBlock: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 10 },
  titleRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    gap: 12,
  },
  title: {
    color: t.text,
    fontSize: getPixels(32),
    fontWeight: '800' as const,
    letterSpacing: -0.9,
    flexShrink: 1,
  },
  subtitle: { color: t.textDim, fontSize: getPixels(13), marginTop: 3 },

  sectionBlock: { paddingTop: 20, paddingBottom: 8, gap: 3 },
  sectionTitle: {
    color: t.text,
    fontSize: getPixels(19),
    fontWeight: '800' as const,
    letterSpacing: -0.4,
    flexShrink: 1,
  },
  sectionHint: {
    color: t.textDim,
    fontSize: getPixels(12),
    lineHeight: getPixels(17.5),
  },

  eyebrow: {
    color: t.accent,
    fontSize: getPixels(10.5),
    fontWeight: '800' as const,
    letterSpacing: 0.9,
    textTransform: 'uppercase' as const,
  },
});
