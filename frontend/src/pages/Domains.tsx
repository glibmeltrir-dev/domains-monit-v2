import { useEffect, useState } from 'react';
import { Domain, NamecheapAccount } from '../types.ts';
import { Search, MoreHorizontal, RefreshCw, Trash2, CheckSquare, Square, ChevronLeft, ChevronRight, Settings, ExternalLink, X, AlertTriangle, Target, ShieldCheck, ShieldAlert, Cloud } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';

export default function Domains() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Integrations for NC balance
  const [ncAccounts, setNcAccounts] = useState<NamecheapAccount[]>([]);

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  // Anchor for shift-click range selection.
  const [lastSelectedId, setLastSelectedId] = useState<number | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 50;

  // Modals
  const [renewModal, setRenewModal] = useState<{ isOpen: boolean; ids: number[] }>({ isOpen: false, ids: [] });
  const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; ids: number[] }>({ isOpen: false, ids: [] });

  // Provider sync / Keitaro actions
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 6000);
  };

  const runSync = async () => {
    setSyncing(true);
    try {
      await fetch('/api/domains/sync', { method: 'POST' });
      flash('Синхронизация с Cloudflare / Namecheap / Keitaro запущена — данные обновятся в фоне.');
    } catch {
      flash('Не удалось запустить синхронизацию.');
    } finally {
      setSyncing(false);
    }
  };

  const monitorCheck = async (id: number) => {
    try {
      await fetch(`/api/domains/${id}/check`, { method: 'POST' });
      flash('Проверка запущена.');
    } catch {
      flash('Не удалось запустить проверку.');
    }
  };

  const pointToKeitaro = async (ids: number[]) => {
    if (!ids.length) return;
    try {
      await fetch('/api/domains/point-to-keitaro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      setSelectedIds(new Set());
      flash(`Направляем ${ids.length} домен(ов) на Keitaro — DNS и привязка обновляются в фоне.`);
    } catch {
      flash('Не удалось поставить задачу.');
    }
  };

  const fetchData = () => {
    fetch('/api/domains')
      .then(res => res.json())
      .then(data => {
        setDomains(data);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchData();
    fetch('/api/integrations').then(res => res.json()).then(data => setNcAccounts(data.namecheap));
  }, []);

  const handleSelect = (e: React.MouseEvent, id: number) => {
    // Shift-click: select the whole range between the anchor and this row
    // (based on the current filtered order), matching the anchor's state.
    if (e.shiftKey && lastSelectedId !== null && lastSelectedId !== id) {
      const ids = filteredDomains.map(d => d.id);
      const a = ids.indexOf(lastSelectedId);
      const b = ids.indexOf(id);
      if (a !== -1 && b !== -1) {
        const [start, end] = a < b ? [a, b] : [b, a];
        const range = ids.slice(start, end + 1);
        const shouldSelect = selectedIds.has(lastSelectedId);
        const next = new Set(selectedIds);
        range.forEach(rid => (shouldSelect ? next.add(rid) : next.delete(rid)));
        setSelectedIds(next);
        setLastSelectedId(id);
        return;
      }
    }
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
    setLastSelectedId(id);
  };

  const filteredDomains = domains.filter(d => {
    if (search && !d.domain_name.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter !== 'ALL' && d.monitoring_status !== statusFilter) return false;
    return true;
  });

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredDomains.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredDomains.map(d => d.id)));
    }
  };

  const totalPages = Math.ceil(filteredDomains.length / pageSize) || 1;
  const paginatedDomains = filteredDomains.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, statusFilter]);

  const confirmDelete = async () => {
    for (const id of deleteModal.ids) {
      await fetch(`/api/crud/domains/${id}`, { method: 'DELETE' });
    }
    setDeleteModal({ isOpen: false, ids: [] });
    setSelectedIds(new Set());
    fetchData();
  };

  const confirmRenew = async () => {
    // just close for now since real logic isn't there
    setRenewModal({ isOpen: false, ids: [] });
    setSelectedIds(new Set());
    fetchData();
  };

  // Get Namecheap account for renewal to show balance. Assuming we renew all selected domains from their respective accounts.
  // For simplicity, we just show the balance of the first selected domain's NC account.
  let ncBalance = 0;
  if (renewModal.isOpen && renewModal.ids.length > 0) {
    const d = domains.find(x => x.id === renewModal.ids[0]);
    if (d) {
      const nc = ncAccounts.find(x => x.id === d.namecheap_account_id);
      if (nc) ncBalance = nc.balance || 0;
    }
  }

  const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : '—');
  const daysLeft = (d?: string | null) =>
    d ? Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000) : null;

  return (
    <div className="p-8 h-full flex flex-col relative">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight mb-1">Домены</h1>
          <p className="text-sm text-white/50">Управление и мониторинг всех доменов</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-white/40 absolute left-3 top-1/2 -translate-y-1/2" />
            <input 
              type="text" 
              placeholder="Поиск по домену..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-white/5 border border-white/10 rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:border-[#FFBC03] transition-colors w-64"
            />
          </div>
          <select 
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-black/20 border border-white/10 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-[#FFBC03]"
          >
            <option value="ALL">Все статусы</option>
            <option value="UP">UP</option>
            <option value="SLOW">SLOW</option>
            <option value="DOWN">DOWN</option>
          </select>
          <button
            onClick={runSync}
            disabled={syncing}
            title="Обновить NS, реальный IP, срок домена и наличие в Keitaro"
            className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg px-4 py-2 text-sm transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
            Синхронизировать
          </button>
        </div>
      </div>

      {toast && (
        <div className="mb-4 rounded-lg border border-[#FFBC03]/30 bg-[#FFBC03]/10 px-4 py-2.5 text-sm text-[#FFBC03]">
          {toast}
        </div>
      )}

      <div className="flex-1 bg-black/20 rounded-xl border border-white/5 overflow-hidden flex flex-col">
        {selectedIds.size > 0 && (
          <div className="bg-[#FFBC03]/10 border-b border-[#FFBC03]/20 px-4 py-3 flex items-center justify-between">
            <span className="text-sm font-medium text-[#FFBC03]">Выбрано доменов: {selectedIds.size}</span>
            <div className="flex items-center gap-2">
              <button onClick={() => pointToKeitaro(Array.from(selectedIds))} className="text-xs font-medium px-3 py-1.5 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 rounded border border-emerald-500/20 transition-colors flex items-center gap-1">
                <Target className="w-3 h-3" /> Направить на Keitaro
              </button>
              <button onClick={() => setRenewModal({ isOpen: true, ids: Array.from(selectedIds) })} className="text-xs font-medium px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded border border-white/10 transition-colors">Продлить</button>
              <button onClick={() => setDeleteModal({ isOpen: true, ids: Array.from(selectedIds) })} className="text-xs font-medium px-3 py-1.5 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 rounded border border-rose-500/20 transition-colors flex items-center gap-1">
                <Trash2 className="w-3 h-3" /> Удалить
              </button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto flex-1">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-white/5 text-white/60 sticky top-0 backdrop-blur-md z-10">
              <tr>
                <th className="px-4 py-3 font-medium w-10">
                  <button onClick={toggleSelectAll} className="text-white/40 hover:text-white">
                    {selectedIds.size > 0 && selectedIds.size === filteredDomains.length ? (
                      <CheckSquare className="w-4 h-4 text-[#FFBC03]" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                  </button>
                </th>
                <th className="px-4 py-3 font-medium">Домен</th>
                <th className="px-4 py-3 font-medium">Мониторинг</th>
                <th className="px-4 py-3 font-medium">SSL до</th>
                <th className="px-4 py-3 font-medium">Домен до</th>
                <th className="px-4 py-3 font-medium">Реальный IP</th>
                <th className="px-4 py-3 font-medium">Keitaro</th>
                <th className="px-4 py-3 font-medium">NS</th>
                <th className="px-4 py-3 font-medium text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-white/40">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
                    Загрузка...
                  </td>
                </tr>
              ) : paginatedDomains.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-white/40">
                    Нет доменов
                  </td>
                </tr>
              ) : (
                paginatedDomains.map(domain => (
                  <tr key={domain.id} className={`hover:bg-white/[0.02] transition-colors group ${selectedIds.has(domain.id) ? 'bg-white/[0.02]' : ''}`}>
                    <td className="px-4 py-3">
                      <button onClick={(e) => handleSelect(e, domain.id)} className="text-white/40 hover:text-white select-none">
                        {selectedIds.has(domain.id) ? (
                          <CheckSquare className="w-4 h-4 text-[#FFBC03]" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-3 font-medium">{domain.domain_name}</td>
                    <td className="px-4 py-3">
                       <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium ${
                        domain.monitoring_status === 'UP' ? 'text-emerald-400 bg-emerald-400/10' :
                        domain.monitoring_status === 'SLOW' ? 'text-amber-400 bg-amber-400/10' :
                        domain.monitoring_status === 'DOWN' ? 'text-rose-400 bg-rose-400/10' :
                        'text-white/50 bg-white/5'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          domain.monitoring_status === 'UP' ? 'bg-emerald-400' :
                          domain.monitoring_status === 'SLOW' ? 'bg-amber-400' :
                          domain.monitoring_status === 'DOWN' ? 'bg-rose-400' :
                          'bg-white/40'
                        }`}></span>
                        {domain.monitoring_status}
                      </span>
                    </td>
                    {/* SSL expiry */}
                    <td className="px-4 py-3 text-xs">
                      {(() => {
                        const dl = daysLeft(domain.ssl_valid_till);
                        if (dl === null) return <span className="text-white/40">—</span>;
                        const cls = dl <= 7 ? 'text-rose-400' : dl <= 21 ? 'text-amber-400' : 'text-white/70';
                        return (
                          <span className={cls} title={`${dl} дн.`}>{fmtDate(domain.ssl_valid_till)}</span>
                        );
                      })()}
                    </td>
                    {/* Domain registry expiry */}
                    <td className="px-4 py-3 text-xs">
                      {(() => {
                        const dl = daysLeft(domain.expiration_date);
                        if (dl === null) return <span className="text-white/40">—</span>;
                        const cls = dl <= 14 ? 'text-rose-400' : dl <= 30 ? 'text-amber-400' : 'text-white/70';
                        return (
                          <span className={cls} title={`${dl} дн.`}>{fmtDate(domain.expiration_date)}</span>
                        );
                      })()}
                    </td>
                    {/* Real origin IP (from Cloudflare) vs Keitaro */}
                    <td className="px-4 py-3 text-xs">
                      {domain.resolved_ip ? (
                        <div className="flex flex-col gap-1">
                          <span className="font-mono text-white/70 flex items-center gap-1">
                            {domain.resolved_ip}
                            {domain.proxied ? <Cloud className="w-3 h-3 text-orange-400" /> : null}
                          </span>
                          {domain.keitaro_ip && (
                            domain.resolved_ip === domain.keitaro_ip ? (
                              <span className="inline-flex items-center gap-1 text-emerald-400">
                                <ShieldCheck className="w-3 h-3" /> на Keitaro
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-amber-400">
                                <ShieldAlert className="w-3 h-3" /> не Keitaro
                              </span>
                            )
                          )}
                        </div>
                      ) : (
                        <span className="text-white/40">—</span>
                      )}
                    </td>
                    {/* Keitaro tracker + membership */}
                    <td className="px-4 py-3 text-xs">
                      {domain.keitaro_name ? (
                        <div className="flex flex-col gap-1">
                          <span className="text-sm text-white/80">{domain.keitaro_name}</span>
                          <span className="font-mono text-white/40">{domain.keitaro_ip}</span>
                        </div>
                      ) : (
                        <span className="text-white/40">—</span>
                      )}
                      {domain.keitaro_registered === true ? (
                        <span className="mt-1 inline-flex items-center gap-1 text-emerald-400">
                          <ShieldCheck className="w-3 h-3" /> в трекере
                        </span>
                      ) : domain.keitaro_registered === false ? (
                        <span className="mt-1 inline-flex items-center gap-1 text-white/40">нет в трекере</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-white/50 text-xs">
                      <div className="flex flex-col gap-0.5">
                        {domain.ns ? domain.ns.split('\n').filter(Boolean).map((ns, i) => (
                          <span key={i}>{ns}</span>
                        )) : <span className="text-white/40">—</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => setRenewModal({ isOpen: true, ids: [domain.id] })} className="p-1 hover:text-[#FFBC03] transition-colors" title="Продлить">
                          <RefreshCw className="w-4 h-4" />
                        </button>
                        <button onClick={() => setDeleteModal({ isOpen: true, ids: [domain.id] })} className="p-1 hover:text-rose-400 transition-colors" title="Удалить">
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <DropdownMenu.Root>
                          <DropdownMenu.Trigger asChild>
                            <button className="p-1 hover:text-white transition-colors" title="Дополнительно">
                              <MoreHorizontal className="w-4 h-4" />
                            </button>
                          </DropdownMenu.Trigger>
                          <DropdownMenu.Portal>
                            <DropdownMenu.Content 
                              className="min-w-[160px] bg-[#2a2a2a] rounded-lg p-1 shadow-xl border border-white/10 text-sm z-50 animate-in fade-in zoom-in-95 duration-100" 
                              sideOffset={5}
                              align="end"
                            >
                              <DropdownMenu.Item onClick={() => window.open(`https://${domain.domain_name}`, '_blank')} className="flex items-center gap-2 px-3 py-2 outline-none cursor-pointer rounded hover:bg-white/10 text-white/80 hover:text-white transition-colors">
                                <ExternalLink className="w-4 h-4" /> Открыть сайт
                              </DropdownMenu.Item>
                              <DropdownMenu.Item onClick={() => pointToKeitaro([domain.id])} className="flex items-center gap-2 px-3 py-2 outline-none cursor-pointer rounded hover:bg-white/10 text-emerald-400 transition-colors">
                                <Target className="w-4 h-4" /> Направить на Keitaro
                              </DropdownMenu.Item>
                              <DropdownMenu.Item onClick={() => domain.id && monitorCheck(domain.id)} className="flex items-center gap-2 px-3 py-2 outline-none cursor-pointer rounded hover:bg-white/10 text-white/80 hover:text-white transition-colors">
                                <Settings className="w-4 h-4" /> Проверить сейчас
                              </DropdownMenu.Item>
                              <DropdownMenu.Separator className="h-px bg-white/10 my-1" />
                              <DropdownMenu.Item onClick={() => setDeleteModal({ isOpen: true, ids: [domain.id] })} className="flex items-center gap-2 px-3 py-2 outline-none cursor-pointer rounded hover:bg-rose-500/20 text-rose-400 transition-colors">
                                <Trash2 className="w-4 h-4" /> Удалить из системы
                              </DropdownMenu.Item>
                            </DropdownMenu.Content>
                          </DropdownMenu.Portal>
                        </DropdownMenu.Root>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="border-t border-white/5 px-4 py-3 flex items-center justify-between text-sm text-white/50 bg-black/20">
          <div>
            Показано {(currentPage - 1) * pageSize + 1} - {Math.min(currentPage * pageSize, filteredDomains.length)} из {filteredDomains.length}
          </div>
          <div className="flex items-center gap-2">
            <button 
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(p => p - 1)}
              className="p-1 rounded hover:bg-white/10 disabled:opacity-30 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-2 font-medium text-white/70">{currentPage} / {totalPages}</span>
            <button 
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage(p => p + 1)}
              className="p-1 rounded hover:bg-white/10 disabled:opacity-30 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Delete Modal */}
      {deleteModal.isOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-[#212121] border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between p-4 border-b border-white/5">
              <h3 className="font-medium text-rose-400 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Подтверждение удаления
              </h3>
              <button onClick={() => setDeleteModal({ isOpen: false, ids: [] })} className="text-white/40 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            
            <div className="p-5">
              <p className="text-white/70 text-sm mb-6">
                Вы уверены, что хотите удалить {deleteModal.ids.length === 1 ? 'этот домен' : `${deleteModal.ids.length} доменов`}? Это действие нельзя отменить.
              </p>

              <div className="flex justify-end gap-3">
                <button onClick={() => setDeleteModal({ isOpen: false, ids: [] })} className="px-4 py-2 text-sm text-white/60 hover:text-white">Отмена</button>
                <button onClick={confirmDelete} className="bg-rose-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-rose-600 transition-colors">Удалить</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Renew Modal */}
      {renewModal.isOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-[#212121] border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between p-4 border-b border-white/5">
              <h3 className="font-medium flex items-center gap-2">
                Продление доменов
              </h3>
              <button onClick={() => setRenewModal({ isOpen: false, ids: [] })} className="text-white/40 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            
            <div className="p-5">
              <div className="bg-white/5 border border-white/10 rounded-lg p-4 mb-6 space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-white/50">Выбрано доменов:</span>
                  <span>{renewModal.ids.length}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-white/50">Баланс Namecheap:</span>
                  <span className="text-[#FFBC03] font-medium">${ncBalance.toFixed(2)}</span>
                </div>
              </div>
              <p className="text-white/70 text-sm mb-6">
                С баланса аккаунта Namecheap будет списана стоимость продления. Вы уверены, что хотите продолжить?
              </p>

              <div className="flex justify-end gap-3">
                <button onClick={() => setRenewModal({ isOpen: false, ids: [] })} className="px-4 py-2 text-sm text-white/60 hover:text-white">Отмена</button>
                <button onClick={confirmRenew} className="bg-[#FFBC03] text-[#212121] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#FFBC03]/90 transition-colors">Подтвердить продление</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
