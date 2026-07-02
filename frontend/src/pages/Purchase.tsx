import { useEffect, useState } from 'react';
import { Search, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { NamecheapAccount, CloudflareAccount, KeitaroTracker, CloudflareTemplate } from '../types.ts';

interface CheckResult {
  domain: string;
  available: boolean;
  isPremium: boolean;
  premiumPrice?: number;
}

export default function Purchase() {
  const [domains, setDomains] = useState('');
  const [integrations, setIntegrations] = useState<{
    namecheap: NamecheapAccount[];
    cloudflare: CloudflareAccount[];
    keitaro: KeitaroTracker[];
    groups: any[];
  } | null>(null);
  const [templates, setTemplates] = useState<CloudflareTemplate[]>([]);

  const [selectedGroupId, setSelectedGroupId] = useState<number | ''>('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | ''>('');
  const [register, setRegister] = useState(true);

  const [checking, setChecking] = useState(false);
  const [buying, setBuying] = useState(false);
  const [results, setResults] = useState<CheckResult[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/integrations').then((res) => res.json()).then((data) => {
      setIntegrations(data);
      if (data.groups.length > 0) setSelectedGroupId(data.groups[0].id);
    });
    fetch('/api/templates').then((res) => res.json()).then((data) => {
      setTemplates(data);
      if (data.length > 0) setSelectedTemplateId(data[0].id);
    });
  }, []);

  const domainList = domains.split('\n').map((d) => d.trim()).filter(Boolean);

  const available = results?.filter((r) => r.available) ?? [];
  const taken = results?.filter((r) => !r.available) ?? [];

  const check = async () => {
    if (!domainList.length) return;
    setChecking(true);
    setMessage(null);
    try {
      const res = await fetch('/api/purchase/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domains: domainList, group_id: selectedGroupId || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResults(data.results);
    } catch (e: any) {
      setMessage(e.message || 'Ошибка проверки');
    } finally {
      setChecking(false);
    }
  };

  const buy = async () => {
    const toBuy = (available.length ? available.map((r) => r.domain) : domainList);
    if (!toBuy.length) return;
    setBuying(true);
    setMessage(null);
    try {
      const res = await fetch('/api/purchase/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domains: toBuy,
          group_id: selectedGroupId || null,
          cf_template_id: selectedTemplateId || null,
          register,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMessage(`В очередь на подключение поставлено: ${data.queued} доменов`);
      setResults(null);
    } catch (e: any) {
      setMessage(e.message || 'Ошибка покупки');
    } finally {
      setBuying(false);
    }
  };

  return (
    <div className="p-8 h-full flex flex-col">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight mb-1">Покупка доменов</h1>
        <p className="text-sm text-white/50">Массовая проверка, регистрация и подключение</p>
      </div>

      <div className="grid grid-cols-3 gap-8 flex-1 min-h-0">
        <div className="col-span-2 flex flex-col min-h-0">
          <div className="bg-white/5 border border-white/10 rounded-xl p-1 flex flex-col flex-1 min-h-0">
            <textarea
              value={domains}
              onChange={(e) => setDomains(e.target.value)}
              placeholder="Введите домены (каждый с новой строки)..."
              className="w-full flex-1 bg-transparent resize-none p-4 focus:outline-none text-sm font-mono leading-relaxed"
            />
            <div className="p-4 border-t border-white/10 bg-black/20 flex justify-between items-center rounded-b-lg">
              <span className="text-sm text-white/50">Доменов: {domainList.length}</span>
              <button
                onClick={check}
                disabled={checking || !domainList.length}
                className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg font-medium text-sm flex items-center gap-2 transition-colors disabled:opacity-50"
              >
                {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Проверить доступность
              </button>
            </div>
          </div>

          {results && (
            <div className="mt-4 max-h-48 overflow-auto bg-black/20 border border-white/10 rounded-xl p-3 text-sm space-y-1">
              {results.map((r) => (
                <div key={r.domain} className="flex items-center justify-between">
                  <span className="font-mono">{r.domain}</span>
                  {r.available ? (
                    <span className="text-emerald-400 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> свободен{r.isPremium ? ' (premium)' : ''}</span>
                  ) : (
                    <span className="text-rose-400 flex items-center gap-1"><XCircle className="w-3.5 h-3.5" /> занят</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <div className="bg-white/5 border border-white/10 rounded-xl p-5">
            <h3 className="font-medium mb-4">Настройки группы</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-white/50 mb-1.5">Группа интеграций</label>
                <select
                  value={selectedGroupId}
                  onChange={(e) => setSelectedGroupId(Number(e.target.value))}
                  className="w-full bg-black/20 border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:border-[#FFBC03] appearance-none"
                >
                  {integrations?.groups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                  {!integrations?.groups.length && <option value="">Нет групп</option>}
                </select>
              </div>
              <div>
                <label className="block text-xs text-white/50 mb-1.5">Шаблон Cloudflare</label>
                <select
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(Number(e.target.value))}
                  className="w-full bg-black/20 border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:border-[#FFBC03] appearance-none"
                >
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                  {!templates.length && <option value="">Нет шаблонов</option>}
                </select>
              </div>
              <label className="flex items-center gap-3 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={register}
                  onChange={(e) => setRegister(e.target.checked)}
                  className="rounded border-white/20 bg-transparent accent-[#FFBC03]"
                />
                <span className="text-sm">Регистрировать на Namecheap</span>
              </label>
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-xl p-5">
            <h3 className="font-medium mb-4">Сводка</h3>
            <div className="space-y-2 text-sm mb-6">
              <div className="flex justify-between text-white/70">
                <span>Доступно:</span>
                <span className="text-emerald-400">{available.length}</span>
              </div>
              <div className="flex justify-between text-white/70">
                <span>Занято:</span>
                <span className="text-rose-400">{taken.length}</span>
              </div>
            </div>

            <button
              onClick={buy}
              disabled={buying || (!domainList.length)}
              className="w-full bg-[#FFBC03] text-[#212121] py-2.5 rounded-lg font-medium hover:bg-[#FFBC03]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {buying && <Loader2 className="w-4 h-4 animate-spin" />}
              {register ? 'Купить и настроить' : 'Подключить'}
            </button>
            {message && <p className="text-xs text-white/60 mt-3">{message}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
