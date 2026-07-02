import { useEffect, useMemo, useState } from 'react';
import { Domain } from '../types.ts';
import { Search, Loader2, ArrowRight, RefreshCcw, AlertTriangle, CheckCircle2, Users, Megaphone } from 'lucide-react';

interface KeitaroUsage {
  domain: string;
  keitaroId: number | null;
  groupId: number | null;
  campaigns: Array<{ id: number; name: string }>;
}

interface NewDomainCheck {
  newDomain: string;
  existsInKeitaro: boolean;
  groupId: number | null;
  campaigns: Array<{ id: number; name: string }>;
  clean: boolean;
}

interface ReplaceReport {
  oldDomain: string;
  newDomain: string;
  newId: number;
  newKeitaroId: number | null;
  oldKeitaroId: number | null;
  groupId: number | null;
  campaignsRebound: number;
  steps: string[];
  warnings: string[];
}

export default function Replace() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [query, setQuery] = useState('');
  const [oldId, setOldId] = useState<number | null>(null);
  const [newDomain, setNewDomain] = useState('');

  const [usage, setUsage] = useState<KeitaroUsage | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  const [check, setCheck] = useState<NewDomainCheck | null>(null);
  const [checking, setChecking] = useState(false);

  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<ReplaceReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/domains')
      .then(res => res.json())
      .then((data: Domain[]) => setDomains(Array.isArray(data) ? data : []));
  }, []);

  const selected = domains.find(d => d.id === oldId) || null;

  // Отфильтрованный список с приоритетом истекающих доменов сверху.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? domains.filter(d => d.domain_name.toLowerCase().includes(q)) : domains;
    const ts = (d: Domain) => (d.expiration_date ? new Date(d.expiration_date).getTime() : Infinity);
    return [...list].sort((a, b) => ts(a) - ts(b)).slice(0, 50);
  }, [domains, query]);

  useEffect(() => {
    if (oldId == null) {
      setUsage(null);
      return;
    }
    setUsageLoading(true);
    setUsage(null);
    fetch(`/api/domains/${oldId}/keitaro-usage`)
      .then(res => res.json())
      .then((data: KeitaroUsage) => setUsage(data))
      .catch(() => setUsage(null))
      .finally(() => setUsageLoading(false));
  }, [oldId]);

  // Дебаунс-проверка нового домена в Keitaro (должен быть чистым).
  useEffect(() => {
    const name = newDomain.trim();
    if (oldId == null || !name) {
      setCheck(null);
      setChecking(false);
      return;
    }
    setChecking(true);
    const t = setTimeout(() => {
      fetch(`/api/domains/${oldId}/new-domain-check?newDomain=${encodeURIComponent(name)}`)
        .then(res => res.json())
        .then((data: NewDomainCheck) => setCheck(data))
        .catch(() => setCheck(null))
        .finally(() => setChecking(false));
    }, 400);
    return () => clearTimeout(t);
  }, [oldId, newDomain]);

  const daysLeft = (d?: string | null) =>
    d ? Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000) : null;

  const runReplace = async () => {
    if (!oldId || !newDomain.trim()) return;
    setRunning(true);
    setError(null);
    setReport(null);
    try {
      const res = await fetch('/api/domains/replace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldId, newDomain: newDomain.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка замены');
      setReport(data);
      // Обновляем список доменов после успешной замены.
      fetch('/api/domains').then(r => r.json()).then((d: Domain[]) => setDomains(Array.isArray(d) ? d : []));
      setOldId(null);
      setNewDomain('');
      setQuery('');
    } catch (e: any) {
      setError(e.message || 'Ошибка замены');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="p-8 h-full flex flex-col">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight mb-1">Замена домена</h1>
        <p className="text-sm text-white/50">Замена истекающего домена новым с переносом группы и кампаний Keitaro</p>
      </div>

      <div className="grid grid-cols-3 gap-8 flex-1 min-h-0">
        {/* Выбор старого домена */}
        <div className="flex flex-col min-h-0">
          <div className="bg-white/5 border border-white/10 rounded-xl p-5 flex flex-col flex-1 min-h-0">
            <label className="block text-xs text-white/50 mb-2">Домен для замены</label>
            <div className="relative mb-3">
              <Search className="w-4 h-4 text-white/40 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Поиск по домену..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full bg-black/20 border border-white/10 rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:border-[#FFBC03]"
              />
            </div>
            <div className="flex-1 overflow-auto -mx-1 px-1 space-y-1">
              {filtered.length === 0 ? (
                <p className="text-sm text-white/40 px-2 py-4">Нет доменов</p>
              ) : (
                filtered.map(d => {
                  const dl = daysLeft(d.expiration_date);
                  const active = d.id === oldId;
                  return (
                    <button
                      key={d.id}
                      onClick={() => setOldId(d.id)}
                      className={`w-full text-left px-3 py-2 rounded-lg border text-sm transition-colors ${
                        active
                          ? 'bg-[#FFBC03]/10 border-[#FFBC03]/40 text-white'
                          : 'bg-transparent border-transparent hover:bg-white/5 text-white/80'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium truncate">{d.domain_name}</span>
                        {dl !== null && (
                          <span className={`text-xs shrink-0 ${dl <= 14 ? 'text-rose-400' : dl <= 30 ? 'text-amber-400' : 'text-white/40'}`}>
                            {dl} дн.
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Новый домен + план */}
        <div className="col-span-2 flex flex-col gap-6 min-h-0 overflow-auto">
          <div className="bg-white/5 border border-white/10 rounded-xl p-5">
            <label className="block text-xs text-white/50 mb-2">Новый домен</label>
            <input
              type="text"
              placeholder="example.com"
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              className="w-full bg-black/20 border border-white/10 rounded-lg px-4 py-2 text-sm font-mono focus:outline-none focus:border-[#FFBC03]"
            />

            <div className="mt-5 flex items-center gap-3 text-sm">
              <span className="px-3 py-1.5 rounded-lg bg-black/20 border border-white/10 font-mono text-white/80">
                {selected?.domain_name || '— выберите домен —'}
              </span>
              <ArrowRight className="w-4 h-4 text-[#FFBC03] shrink-0" />
              <span className="px-3 py-1.5 rounded-lg bg-black/20 border border-white/10 font-mono text-white/80">
                {newDomain.trim() || '— новый домен —'}
              </span>
            </div>

            {/* Статус проверки нового домена */}
            {oldId != null && newDomain.trim() && (
              <div className="mt-4 text-sm">
                {checking ? (
                  <span className="flex items-center gap-2 text-white/50">
                    <Loader2 className="w-4 h-4 animate-spin" /> Проверяем новый домен в Keitaro...
                  </span>
                ) : check ? (
                  check.clean ? (
                    <span className="flex items-center gap-2 text-emerald-400">
                      <CheckCircle2 className="w-4 h-4" />
                      {check.existsInKeitaro
                        ? 'Домен есть в Keitaro и он чистый (без группы и кампаний) — можно заменять.'
                        : 'Домен ещё не в Keitaro — будет создан при замене.'}
                    </span>
                  ) : (
                    <span className="flex items-center gap-2 text-rose-400">
                      <AlertTriangle className="w-4 h-4" />
                      Новый домен уже привязан к группе/кампаниям в Keitaro — выберите чистый домен.
                    </span>
                  )
                ) : null}
              </div>
            )}
          </div>

          {/* План действий */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-5">
            <h3 className="font-medium mb-4 flex items-center gap-2">
              <RefreshCcw className="w-4 h-4 text-[#FFBC03]" /> Что произойдёт
            </h3>
            <ol className="space-y-2 text-sm text-white/70 list-decimal list-inside">
              <li>Новый домен добавится в систему и унаследует интеграции старого.</li>
              <li>Новый домен будет направлен на Keitaro через Cloudflare (A → IP, www → CNAME).</li>
              <li>Группа Keitaro старого домена перейдёт на новый.</li>
              <li>Все кампании старого домена будут перепривязаны на новый.</li>
              <li>Старый домен будет удалён из Keitaro и из системы.</li>
            </ol>

            {oldId != null && (
              <div className="mt-5 pt-4 border-t border-white/10">
                {usageLoading ? (
                  <p className="text-sm text-white/50 flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Загрузка данных Keitaro...
                  </p>
                ) : usage ? (
                  <div className="flex items-center gap-6 text-sm">
                    <span className="flex items-center gap-2 text-white/70">
                      <Users className="w-4 h-4 text-white/40" />
                      Группа: <span className="text-white">{usage.groupId ?? '—'}</span>
                    </span>
                    <span className="flex items-center gap-2 text-white/70">
                      <Megaphone className="w-4 h-4 text-white/40" />
                      Кампаний: <span className="text-white">{usage.campaigns.length}</span>
                    </span>
                    {usage.keitaroId == null && (
                      <span className="text-amber-400 text-xs">домен не найден в Keitaro</span>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-white/40">Нет данных Keitaro для этого домена.</p>
                )}
              </div>
            )}

            <button
              onClick={runReplace}
              disabled={running || checking || !oldId || !newDomain.trim() || (check != null && !check.clean)}
              className="mt-6 w-full bg-[#FFBC03] text-[#212121] py-2.5 rounded-lg font-medium hover:bg-[#FFBC03]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {running && <Loader2 className="w-4 h-4 animate-spin" />}
              Заменить домен
            </button>
          </div>

          {/* Ошибка */}
          {error && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Отчёт */}
          {report && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5">
              <h3 className="font-medium mb-4 flex items-center gap-2 text-emerald-400">
                <CheckCircle2 className="w-4 h-4" /> Замена выполнена
              </h3>
              <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                <div className="flex justify-between bg-black/20 rounded-lg px-3 py-2">
                  <span className="text-white/50">Старый → Новый</span>
                  <span className="font-mono">{report.oldDomain} → {report.newDomain}</span>
                </div>
                <div className="flex justify-between bg-black/20 rounded-lg px-3 py-2">
                  <span className="text-white/50">Группа</span>
                  <span>{report.groupId ?? '—'}</span>
                </div>
                <div className="flex justify-between bg-black/20 rounded-lg px-3 py-2">
                  <span className="text-white/50">Кампаний перепривязано</span>
                  <span className="text-[#FFBC03] font-medium">{report.campaignsRebound}</span>
                </div>
                <div className="flex justify-between bg-black/20 rounded-lg px-3 py-2">
                  <span className="text-white/50">Keitaro id (старый/новый)</span>
                  <span>{report.oldKeitaroId ?? '—'} / {report.newKeitaroId ?? '—'}</span>
                </div>
              </div>

              {report.steps.length > 0 && (
                <ul className="space-y-1 text-sm text-white/70 mb-3">
                  {report.steps.map((s, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 text-emerald-400 shrink-0" />
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              )}

              {report.warnings.length > 0 && (
                <ul className="space-y-1 text-sm text-amber-300/90">
                  {report.warnings.map((w, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
