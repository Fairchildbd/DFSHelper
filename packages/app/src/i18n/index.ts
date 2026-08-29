import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './en';

export const FALLBACK_LANGUAGE = 'en';

export type MessageKey = keyof typeof en;

i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: getLocales()[0]?.languageTag ?? FALLBACK_LANGUAGE,
  fallbackLng: FALLBACK_LANGUAGE,
  interpolation: { escapeValue: false },
  returnNull: false,
});

export { t } from 'i18next';
export { Trans, useTranslation } from 'react-i18next';
export default i18n;
