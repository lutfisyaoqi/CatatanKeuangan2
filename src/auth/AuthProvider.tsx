import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { apiService, AuthUser } from '../services/apiService.js';
import { supabase } from '../services/supabaseClient.js';
import { errorDiagnosticCode, logAuthDiagnostic, nextAuthDiagnosticMountCount } from '../services/authDiagnostics.js';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  recoveryMode: boolean;
  setRecoveryMode: (active: boolean) => void;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string, confirmPassword: string) => Promise<boolean>;
  logout: () => Promise<void>;
  updateUser: (user: AuthUser | null) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const renderCount = useRef(0);
  renderCount.current++;
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [recoveryMode, setRecoveryModeState] = useState(false);
  const recoveryModeRef = useRef(false);
  const sessionSyncVersion = useRef(0);
  logAuthDiagnostic('AuthProvider', 'render', {
    render: renderCount.current,
    hasUser: Boolean(user),
    loading,
    recoveryMode,
  });

  useEffect(() => {
    let active = true;
    const initialVersion = sessionSyncVersion.current;
    logAuthDiagnostic('AuthProvider', 'mount', {
      mount: nextAuthDiagnosticMountCount('catatuang.auth-debug.provider-mounts'),
      navigationType: performance.getEntriesByType('navigation')[0]?.toJSON().type ?? 'unknown',
    });
    void apiService.getSession().then(({ user: sessionUser }) => {
      logAuthDiagnostic('AuthProvider', 'initial getSession resolved', { hasUser: Boolean(sessionUser) });
      if (active && sessionSyncVersion.current === initialVersion) setUser(sessionUser);
    }).catch((error: unknown) => {
      logAuthDiagnostic('AuthProvider', 'initial getSession rejected', { errorCode: errorDiagnosticCode(error) });
      if (active && sessionSyncVersion.current === initialVersion) setUser(null);
    }).finally(() => {
      if (active && sessionSyncVersion.current === initialVersion) setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const version = ++sessionSyncVersion.current;
      logAuthDiagnostic('AuthProvider', 'onAuthStateChange', { event, hasSession: Boolean(session) });
      if (event === 'PASSWORD_RECOVERY') {
        recoveryModeRef.current = true;
        setRecoveryModeState(true);
      }
      if (event === 'SIGNED_OUT' || !session) {
        if (active) {
          setUser(null);
          setLoading(false);
        }
        return;
      }
      if (recoveryModeRef.current) {
        if (active) {
          setUser(null);
          setLoading(false);
        }
        return;
      }
      // Supabase recommends keeping network work outside the auth callback.
      window.setTimeout(() => {
        void apiService.getSession().then(({ user: sessionUser }) => {
          logAuthDiagnostic('AuthProvider', 'event getSession resolved', { event, hasUser: Boolean(sessionUser) });
          if (active && sessionSyncVersion.current === version) setUser(sessionUser);
        }).catch((error: unknown) => {
          logAuthDiagnostic('AuthProvider', 'event getSession rejected', {
            event,
            errorCode: errorDiagnosticCode(error),
          });
          if (active && sessionSyncVersion.current === version) setUser(null);
        }).finally(() => {
          if (active && sessionSyncVersion.current === version) setLoading(false);
        });
      }, 0);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const setRecoveryMode = useCallback((active: boolean) => {
    recoveryModeRef.current = active;
    setRecoveryModeState(active);
    if (active) {
      sessionSyncVersion.current++;
      setUser(null);
    }
  }, []);

  const value: AuthContextValue = {
    user,
    loading,
    recoveryMode,
    setRecoveryMode,
    async login(email, password) {
      const result = await apiService.login(email, password);
      setUser(result.user);
    },
    async register(name, email, password, confirmPassword) {
      const result = await apiService.register(name, email, password, confirmPassword);
      setUser(result.user);
      return result.needsEmailConfirmation;
    },
    async logout() {
      await apiService.logout();
      setUser(null);
    },
    updateUser: setUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}
