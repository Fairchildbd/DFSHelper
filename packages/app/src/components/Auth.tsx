import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, glowStyle, type IconName } from './Icon';
import { useTranslation } from '../i18n';
import { getPixels, radius, useStyles, useTheme, type Theme } from '../theme';

const LOGO = require('../../assets/logo-mark.png');

export function AuthLayout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles(sheet);
  const insets = useSafeAreaInsets();

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.lockup}>
          <View style={[styles.logoGlow, glowStyle(theme, 1.4)]}>
            <View style={styles.logoFrame}>
              <Image
                source={LOGO}
                style={styles.logo}
                accessible
                accessibilityLabel={t('auth.logoAlt')}
                resizeMode="cover"
              />
            </View>
          </View>

          <Text style={styles.wordmark} accessibilityRole="header">
            {t('app.wordmark.lead')}{' '}
            <Text style={styles.wordmarkAccent}>{t('app.wordmark.accent')}</Text>
          </Text>
          <Text style={styles.tagline}>{t('auth.tagline')}</Text>
        </View>

        {children}

        <View style={styles.divider} />

        <View style={styles.syncRow}>
          <Icon name="shield-check-outline" size={21} color={theme.accent} />
          <Text style={styles.syncText}>{t('auth.sync')}</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function AuthForm({ children }: { children: React.ReactNode }) {
  const styles = useStyles(sheet);
  return <View style={styles.form}>{children}</View>;
}

export function AuthActions({ children }: { children: React.ReactNode }) {
  const styles = useStyles(sheet);
  return <View style={styles.actions}>{children}</View>;
}

export function AuthField({
  icon,
  label,
  trailing,
  ...input
}: {
  icon: IconName;
  label: string;
  trailing?: React.ReactNode;
} & React.ComponentProps<typeof TextInput>) {
  const theme = useTheme();
  const styles = useStyles(sheet);

  return (
    <View style={styles.field}>
      <Icon name={icon} size={21} color={theme.accent} />
      <TextInput
        placeholderTextColor={theme.textDim}
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        selectionColor={theme.accent}
        {...input}
        style={[styles.input, input.style]}
      />
      {trailing}
    </View>
  );
}

export function AuthPasswordField({
  icon,
  label,
  showLabel,
  hideLabel,
  ...input
}: {
  icon: IconName;
  label: string;
  showLabel: string;
  hideLabel: string;
} & React.ComponentProps<typeof TextInput>) {
  const theme = useTheme();
  const styles = useStyles(sheet);
  const [revealed, setRevealed] = useState(false);

  return (
    <AuthField
      icon={icon}
      label={label}
      secureTextEntry={!revealed}
      {...input}
      trailing={
        <Pressable
          onPress={() => setRevealed((current) => !current)}
          accessibilityRole="button"
          accessibilityLabel={revealed ? hideLabel : showLabel}
          hitSlop={10}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Icon
            name={revealed ? 'eye-off-outline' : 'eye-outline'}
            size={21}
            color={theme.textDim}
          />
        </Pressable>
      }
    />
  );
}

export function AuthPrimaryButton({
  label,
  onPress,
  pending = false,
}: {
  label: string;
  onPress: () => void;
  pending?: boolean;
}) {
  const theme = useTheme();
  const styles = useStyles(sheet);

  return (
    <Pressable
      onPress={onPress}
      disabled={pending}
      accessibilityRole="button"
      accessibilityState={{ disabled: pending, busy: pending }}
      style={({ pressed }) => [
        styles.button,
        styles.buttonPrimary,
        glowStyle(theme, 1.2),
        pending && styles.buttonPending,
        pressed && styles.pressed,
      ]}
    >
      {pending ? (
        <ActivityIndicator color={theme.onAccent} />
      ) : (
        <Text style={styles.buttonPrimaryText}>{label}</Text>
      )}
    </Pressable>
  );
}

export function AuthError({ message }: { message: string }) {
  const theme = useTheme();
  const styles = useStyles(sheet);

  return (
    <View style={styles.error} accessibilityLiveRegion="polite" accessibilityRole="alert">
      <Icon name="alert-circle-outline" size={19} color={theme.danger} />
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

export function AuthSecondaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  const styles = useStyles(sheet);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.button, styles.buttonSecondary, pressed && styles.pressed]}
    >
      <Text style={styles.buttonSecondaryText}>{label}</Text>
    </Pressable>
  );
}

export function AuthTextButton({ label, onPress }: { label: string; onPress: () => void }) {
  const styles = useStyles(sheet);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      hitSlop={8}
      style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}
    >
      <Text style={styles.textButtonLabel}>{label}</Text>
    </Pressable>
  );
}

export function AuthLink({ label, onPress }: { label: string; onPress?: () => void }) {
  const styles = useStyles(sheet);

  return (
    <Pressable
      onPress={onPress}
      disabled={onPress == null}
      accessibilityRole="button"
      hitSlop={8}
      style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
    >
      <Text style={styles.link}>{label}</Text>
    </Pressable>
  );
}

const FIELD_HEIGHT = 56;

const sheet = (theme: Theme) => ({
  screen: { flex: 1, backgroundColor: theme.bg },
  content: {
    flexGrow: 1,
    justifyContent: 'center' as const,
    paddingHorizontal: 28,
    paddingTop: 32,
  },
  pressed: { opacity: 0.75 },

  lockup: { alignItems: 'center' as const, marginBottom: 30 },
  logoGlow: { borderRadius: 26, backgroundColor: theme.bg },
  logoFrame: {
    width: 112,
    height: 112,
    borderRadius: 26,
    overflow: 'hidden' as const,
  },
  logo: { width: '100%' as const, height: '100%' as const },
  wordmark: {
    color: theme.text,
    fontSize: getPixels(34),
    fontWeight: '800' as const,
    fontStyle: 'italic' as const,
    letterSpacing: -0.8,
    marginTop: 18,
  },
  wordmarkAccent: { color: theme.accent },
  tagline: {
    color: theme.textDim,
    fontSize: getPixels(15),
    marginTop: 6,
  },

  form: { gap: 12 },
  field: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    height: FIELD_HEIGHT,
    paddingHorizontal: 16,
    backgroundColor: theme.surface,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  input: {
    flex: 1,
    color: theme.text,
    fontSize: getPixels(15.5),
    padding: 0,
  },
  linkRow: { alignSelf: 'flex-end' as const, paddingTop: 2 },
  textButton: { alignItems: 'center' as const, paddingVertical: 6 },
  textButtonLabel: {
    color: theme.textDim,
    fontSize: getPixels(14.5),
    fontWeight: '600' as const,
  },
  link: { color: theme.accent, fontSize: getPixels(13.5), fontWeight: '600' as const },

  actions: { gap: 14, marginTop: 22 },
  button: {
    height: FIELD_HEIGHT,
    borderRadius: radius.card,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  buttonPrimary: { backgroundColor: theme.accent },
  buttonPending: { opacity: 0.85 },
  buttonPrimaryText: {
    color: theme.onAccent,
    fontSize: getPixels(16),
    fontWeight: '800' as const,
  },
  buttonSecondary: {
    borderWidth: 1,
    borderColor: theme.accent,
    backgroundColor: 'transparent',
  },
  buttonSecondaryText: {
    color: theme.accent,
    fontSize: getPixels(16),
    fontWeight: '800' as const,
  },

  error: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    marginTop: 16,
    padding: 12,
    borderRadius: radius.card,
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.danger,
  },
  errorText: {
    flex: 1,
    color: theme.text,
    fontSize: getPixels(13.5),
    lineHeight: getPixels(19),
  },

  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.border,
    marginTop: 28,
    marginBottom: 20,
  },

  syncRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12 },
  syncText: {
    flex: 1,
    color: theme.textDim,
    fontSize: getPixels(13),
    lineHeight: getPixels(19),
  },
});
