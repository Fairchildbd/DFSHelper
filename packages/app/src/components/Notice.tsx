import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { getPixels, radius, useStyles, useTheme, type Theme } from '../theme';
import { CardWash } from './Card';
import { Icon, type IconName } from './Icon';

export function Notice({
  children,
  icon = 'trending-up',
  tone = 'accent',
  style,
}: {
  children: React.ReactNode;
  icon?: IconName;
  tone?: 'accent' | 'warn';
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const styles = useStyles(sheet);
  const color = tone === 'warn' ? t.warn : t.accent;

  return (
    <View style={[styles.notice, { borderLeftColor: color }, style]}>
      <CardWash />
      <View style={[styles.puck, { borderColor: color, backgroundColor: t.accentSoft }]}>
        <Icon name={icon} size={22} color={color} />
      </View>
      <Text style={styles.text}>{children}</Text>
    </View>
  );
}

export function InlineNote({
  children,
  icon = 'information-outline',
  style,
}: {
  children: React.ReactNode;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const styles = useStyles(sheet);

  return (
    <View style={[styles.inline, style]}>
      <Icon name={icon} size={15} color={t.textDim} style={styles.inlineIcon} />
      <Text style={styles.inlineText}>{children}</Text>
    </View>
  );
}

const sheet = (t: Theme) => ({
  notice: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 14,
    padding: 14,
    borderRadius: radius.card,
    backgroundColor: t.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.border,
    borderLeftWidth: 2,
    overflow: 'hidden' as const,
  },
  puck: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  text: {
    flex: 1,
    color: t.text,
    fontSize: getPixels(12.5),
    lineHeight: getPixels(18.5),
  },

  inline: {
    flexDirection: 'row' as const,
    gap: 9,
    padding: 11,
    borderRadius: radius.puck,
    backgroundColor: t.surfaceAlt,
  },
  inlineIcon: { marginTop: 1 },
  inlineText: {
    flex: 1,
    color: t.textDim,
    fontSize: getPixels(11.5),
    lineHeight: getPixels(16.5),
  },
});
