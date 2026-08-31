import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import * as SecureStore from 'expo-secure-store';
import {
  fetchMe,
  login as loginRequest,
  logout as logoutRequest,
  register as registerRequest,
  setAuthToken,
  setUnauthorizedHandler,
  type AuthUser,
  type Session,
} from './api';

const TOKEN_KEY = 'dfsmatchup.session.token';
const GUEST_KEY = 'dfsmatchup.session.guest';

type Status = 'restoring' | 'signedOut' | 'guest' | 'signedIn';

interface Credentials {
  email: string;
  password: string;
}

interface Auth {
  status: Status;
  user: AuthUser | null;
  showPurchaseLink: boolean;
  purchaseUrl: string | null;
  signIn: (credentials: Credentials) => Promise<void>;
  createAccount: (credentials: Credentials) => Promise<void>;
  continueAsGuest: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<Auth | null>(null);

export function useAuth(): Auth {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth must be used inside AuthProvider');
  return auth;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('restoring');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [purchase, setPurchase] = useState<{ show: boolean; url: string | null }>({
    show: false,
    url: null,
  });

  const clear = useCallback(async () => {
    setAuthToken(null);
    setUser(null);
    setPurchase({ show: false, url: null });
    setStatus('signedOut');
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(GUEST_KEY);
  }, []);

  const adopt = useCallback(async (session: Session) => {
    await SecureStore.setItemAsync(TOKEN_KEY, session.token);
    await SecureStore.deleteItemAsync(GUEST_KEY);
    setAuthToken(session.token);
    setUser(session.user);
    setStatus('signedIn');
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function restore() {
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      if (!token) {
        // A guest choice is remembered so the front door is not asked again on
        // every launch. The About tab is where they leave it.
        const guest = await SecureStore.getItemAsync(GUEST_KEY);
        if (!cancelled) setStatus(guest ? 'guest' : 'signedOut');
        return;
      }

      setAuthToken(token);
      try {
        const me = await fetchMe();
        if (cancelled) return;
        setUser(me.user);
        setPurchase({ show: me.purchase.showExternalLink, url: me.purchase.url });
        setStatus('signedIn');
      } catch {
        // A stored token that the server no longer honours, or a server that
        // cannot be reached. Either way the only screen that works is login.
        if (!cancelled) await clear();
      }
    }

    restore();
    return () => {
      cancelled = true;
    };
  }, [clear]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      void clear();
    });
    return () => setUnauthorizedHandler(null);
  }, [clear]);

  const signIn = useCallback(
    async (credentials: Credentials) => {
      await adopt(await loginRequest(credentials));
    },
    [adopt],
  );

  const createAccount = useCallback(
    async (credentials: Credentials) => {
      await adopt(await registerRequest(credentials));
    },
    [adopt],
  );

  const continueAsGuest = useCallback(async () => {
    await SecureStore.setItemAsync(GUEST_KEY, 'true');
    setStatus('guest');
  }, []);

  const signOut = useCallback(async () => {
    try {
      if (status === 'signedIn') await logoutRequest();
    } finally {
      // The local session goes whether or not the server acknowledged it.
      // A device that cannot reach the API must still be able to sign out.
      await clear();
    }
  }, [clear, status]);

  const value = useMemo<Auth>(
    () => ({
      status,
      user,
      showPurchaseLink: purchase.show,
      purchaseUrl: purchase.url,
      signIn,
      createAccount,
      continueAsGuest,
      signOut,
    }),
    [status, user, purchase, signIn, createAccount, continueAsGuest, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
