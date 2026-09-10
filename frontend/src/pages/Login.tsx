import { FormEvent, useState } from 'react';
import { Globe, Loader2, ShieldCheck } from 'lucide-react';
import { useAuth } from '../auth.tsx';

export default function Login() {
  const { setupNeeded, refresh } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (setupNeeded && password !== confirm) {
      setError('Пароли не совпадают');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(setupNeeded ? '/api/auth/register' : '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка');
      await refresh();
    } catch (err: any) {
      setError(err.message || 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#212121] text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-10 h-10 rounded-lg bg-[#FFBC03] flex items-center justify-center">
            <Globe className="w-5 h-5 text-[#212121]" strokeWidth={2.5} />
          </div>
          <span className="text-2xl font-bold tracking-tight">DomainOps</span>
        </div>

        <form onSubmit={submit} className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
          <div className="flex items-start gap-2 text-sm text-white/60 mb-2">
            <ShieldCheck className="w-4 h-4 mt-0.5 text-[#FFBC03] shrink-0" />
            {setupNeeded
              ? 'Первый вход: создайте супер-админа. После этого регистрация закроется.'
              : 'Вход в панель. Сессия хранится в защищённой cookie.'}
          </div>

          <div>
            <label className="block text-xs text-white/50 mb-1.5">Логин</label>
            <input
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#FFBC03]"
            />
          </div>
          <div>
            <label className="block text-xs text-white/50 mb-1.5">Пароль</label>
            <input
              type="password"
              autoComplete={setupNeeded ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#FFBC03]"
            />
            {setupNeeded && (
              <p className="mt-1 text-xs text-white/40">Не меньше 12 символов, буквы и цифры</p>
            )}
          </div>
          {setupNeeded && (
            <div>
              <label className="block text-xs text-white/50 mb-1.5">Повторите пароль</label>
              <input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#FFBC03]"
              />
            </div>
          )}

          {error && <p className="text-sm text-rose-400">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full bg-[#FFBC03] text-[#212121] py-2.5 rounded-lg font-medium hover:bg-[#FFBC03]/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {setupNeeded ? 'Создать супер-админа' : 'Войти'}
          </button>
        </form>
      </div>
    </div>
  );
}
