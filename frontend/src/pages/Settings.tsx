import { useEffect, useState } from 'react';
import { Save, Send, CheckCircle2 } from 'lucide-react';

interface SettingsState {
  tg_bot_token: string;
  tg_chat_ids: string;
  notify_monitoring: string;
  notify_expiry: string;
  notify_purchase: string;
  slow_threshold_ms: string;
  ssl_reminder_days: string;
  namecheap_contact: string;
}

const defaults: SettingsState = {
  tg_bot_token: '',
  tg_chat_ids: '',
  notify_monitoring: '1',
  notify_expiry: '1',
  notify_purchase: '1',
  slow_threshold_ms: '1000',
  ssl_reminder_days: '14,7,3,1',
  namecheap_contact: '',
};

export default function Settings() {
  const [form, setForm] = useState<SettingsState>(defaults);
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((data) => setForm({ ...defaults, ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v ?? ''])) }));
  }, []);

  const set = (key: keyof SettingsState, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const save = async () => {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const testTelegram = async () => {
    setTestResult(null);
    const res = await fetch('/api/settings/test-telegram', { method: 'POST' });
    const data = await res.json();
    setTestResult(res.ok ? 'Сообщение отправлено' : data.error || 'Ошибка');
  };

  return (
    <div className="p-8 h-full overflow-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight mb-1">Настройки</h1>
        <p className="text-sm text-white/50">Глобальные параметры системы</p>
      </div>

      <div className="max-w-2xl space-y-8">
        <section className="bg-white/5 border border-white/10 rounded-xl p-6">
          <h2 className="text-lg font-medium mb-4">Telegram Уведомления</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-white/70 mb-1.5">Bot Token</label>
              <input
                type="password"
                value={form.tg_bot_token}
                onChange={(e) => set('tg_bot_token', e.target.value)}
                placeholder="123456789:AAH..."
                className="w-full bg-black/20 border border-white/10 rounded-lg p-2.5 text-sm focus:outline-none focus:border-[#FFBC03] transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm text-white/70 mb-1.5">Chat IDs (через запятую)</label>
              <input
                type="text"
                value={form.tg_chat_ids}
                onChange={(e) => set('tg_chat_ids', e.target.value)}
                placeholder="-1001234567890, 123456789"
                className="w-full bg-black/20 border border-white/10 rounded-lg p-2.5 text-sm focus:outline-none focus:border-[#FFBC03] transition-colors"
              />
            </div>

            <div className="pt-2 space-y-3">
              {([
                ['notify_monitoring', 'Ошибки мониторинга (DOWN / SLOW)'],
                ['notify_expiry', 'Истечение SSL / Регистрации'],
                ['notify_purchase', 'Успешные покупки и настройки'],
              ] as const).map(([key, label]) => (
                <label key={key} className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={form[key] === '1'}
                    onChange={(e) => set(key, e.target.checked ? '1' : '0')}
                    className="rounded border-white/20 bg-transparent accent-[#FFBC03]"
                  />
                  <span className="text-sm">{label}</span>
                </label>
              ))}
            </div>

            <div className="pt-4 flex items-center gap-3">
              <button onClick={save} className="bg-[#FFBC03] text-[#212121] px-4 py-2 rounded-lg font-medium text-sm flex items-center gap-2 hover:bg-[#FFBC03]/90 transition-colors">
                {saved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                {saved ? 'Сохранено' : 'Сохранить'}
              </button>
              <button onClick={testTelegram} className="px-4 py-2 rounded-lg font-medium text-sm text-white/70 hover:bg-white/10 transition-colors border border-white/10 flex items-center gap-2">
                <Send className="w-4 h-4" />
                Тестовое сообщение
              </button>
              {testResult && <span className="text-sm text-white/60">{testResult}</span>}
            </div>
          </div>
        </section>

        <section className="bg-white/5 border border-white/10 rounded-xl p-6">
          <h2 className="text-lg font-medium mb-4">Мониторинг</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-white/70 mb-1.5">Порог SLOW ответа (ms)</label>
              <input
                type="number"
                value={form.slow_threshold_ms}
                onChange={(e) => set('slow_threshold_ms', e.target.value)}
                className="w-full bg-black/20 border border-white/10 rounded-lg p-2.5 text-sm focus:outline-none focus:border-[#FFBC03] transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm text-white/70 mb-1.5">Напоминания об SSL (дней, через запятую)</label>
              <input
                type="text"
                value={form.ssl_reminder_days}
                onChange={(e) => set('ssl_reminder_days', e.target.value)}
                className="w-full bg-black/20 border border-white/10 rounded-lg p-2.5 text-sm focus:outline-none focus:border-[#FFBC03] transition-colors"
              />
            </div>
          </div>
        </section>

        <section className="bg-white/5 border border-white/10 rounded-xl p-6">
          <h2 className="text-lg font-medium mb-4">Namecheap контакт (для регистрации)</h2>
          <p className="text-xs text-white/40 mb-3">
            JSON профиль WHOIS: FirstName, LastName, Address1, City, StateProvince, PostalCode, Country, Phone, EmailAddress.
          </p>
          <textarea
            value={form.namecheap_contact}
            onChange={(e) => set('namecheap_contact', e.target.value)}
            rows={6}
            placeholder='{"FirstName":"John","LastName":"Doe","Address1":"...","City":"...","StateProvince":"...","PostalCode":"...","Country":"US","Phone":"+1.6613102107","EmailAddress":"you@example.com"}'
            className="w-full bg-black/20 border border-white/10 rounded-lg p-2.5 text-sm font-mono focus:outline-none focus:border-[#FFBC03] transition-colors"
          />
        </section>
      </div>
    </div>
  );
}
