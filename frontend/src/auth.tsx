import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export interface AuthUser {
  id: number;
  username: string;
  role: string;
}

interface AuthState {
  loading: boolean;
  setupNeeded: boolean;
  user: AuthUser | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch('/api/auth/status');
    const data = await res.json();
    setSetupNeeded(!!data.setupNeeded);
    setUser(data.user ?? null);
  }, []);

  useEffect(() => {
    refresh()
      .catch(() => {
        setUser(null);
        setSetupNeeded(false);
      })
      .finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener('auth:unauthorized', onUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', onUnauthorized);
  }, []);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    setSetupNeeded(false);
  }, []);

  return (
    <AuthContext.Provider value={{ loading, setupNeeded, user, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
