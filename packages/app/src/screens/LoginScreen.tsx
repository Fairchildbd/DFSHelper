import { useState } from 'react';
import { authErrorMessage } from '../api';
import { useAuth } from '../auth';
import {
  AuthActions,
  AuthError,
  AuthField,
  AuthForm,
  AuthLayout,
  AuthLink,
  AuthPasswordField,
  AuthPrimaryButton,
  AuthSecondaryButton,
  AuthTextButton,
} from '../components/ui';
import { useTranslation } from '../i18n';

export function LoginScreen({
  onCreateAccount,
  onForgotPassword,
}: {
  onCreateAccount: () => void;
  onForgotPassword?: () => void;
}) {
  const { t } = useTranslation();
  const { signIn, continueAsGuest } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    if (pending) return;
    setError(null);

    if (email.trim() === '' || password === '') {
      setError(t('auth.error.missingFields'));
      return;
    }

    setPending(true);
    try {
      await signIn({ email, password });
    } catch (err) {
      setError(authErrorMessage(err));
      setPending(false);
    }
  }

  return (
    <AuthLayout>
      <AuthForm>
        <AuthField
          icon="email-outline"
          label={t('auth.email.label')}
          placeholder={t('auth.email.placeholder')}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          textContentType="emailAddress"
          autoComplete="email"
          editable={!pending}
        />

        <AuthPasswordField
          icon="lock-outline"
          label={t('auth.password.label')}
          placeholder={t('auth.password.placeholder')}
          showLabel={t('auth.password.show')}
          hideLabel={t('auth.password.hide')}
          value={password}
          onChangeText={setPassword}
          textContentType="password"
          autoComplete="password"
          editable={!pending}
          onSubmitEditing={submit}
          returnKeyType="go"
        />

        <AuthLink label={t('auth.forgot')} onPress={onForgotPassword} />
      </AuthForm>

      {error ? <AuthError message={error} /> : null}

      <AuthActions>
        <AuthPrimaryButton label={t('auth.signIn')} onPress={submit} pending={pending} />
        <AuthSecondaryButton label={t('auth.createAccount')} onPress={onCreateAccount} />
        <AuthTextButton label={t('auth.continueAsGuest')} onPress={continueAsGuest} />
      </AuthActions>
    </AuthLayout>
  );
}
