import { useState } from 'react';
import { authErrorMessage } from '../api';
import { useAuth } from '../auth';
import {
  AuthActions,
  AuthError,
  AuthField,
  AuthForm,
  AuthLayout,
  AuthPasswordField,
  AuthPrimaryButton,
  AuthTextButton,
} from '../components/ui';
import { useTranslation } from '../i18n';

const MIN_PASSWORD_LENGTH = 8;

export function CreateAccountScreen() {
  const { t } = useTranslation();
  const { createAccount, continueAsGuest } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verifyPassword, setVerifyPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    if (pending) return;
    setError(null);

    if (email.trim() === '' || password === '') {
      setError(t('auth.error.missingFields'));
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t('auth.error.passwordTooShort', { length: MIN_PASSWORD_LENGTH }));
      return;
    }
    if (password !== verifyPassword) {
      setError(t('auth.error.passwordMismatch'));
      return;
    }

    setPending(true);
    try {
      await createAccount({ email, password });
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
          textContentType="newPassword"
          autoComplete="new-password"
          editable={!pending}
        />

        <AuthPasswordField
          icon="lock-check-outline"
          label={t('auth.verifyPassword.label')}
          placeholder={t('auth.verifyPassword.placeholder')}
          showLabel={t('auth.verifyPassword.show')}
          hideLabel={t('auth.verifyPassword.hide')}
          value={verifyPassword}
          onChangeText={setVerifyPassword}
          textContentType="newPassword"
          autoComplete="new-password"
          editable={!pending}
          onSubmitEditing={submit}
          returnKeyType="go"
        />
      </AuthForm>

      {error ? <AuthError message={error} /> : null}

      <AuthActions>
        <AuthPrimaryButton label={t('auth.createAccount')} onPress={submit} pending={pending} />
        <AuthTextButton label={t('auth.continueAsGuest')} onPress={continueAsGuest} />
      </AuthActions>
    </AuthLayout>
  );
}
