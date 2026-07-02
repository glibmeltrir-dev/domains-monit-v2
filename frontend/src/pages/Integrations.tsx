import { useEffect, useState } from 'react';
import { NamecheapAccount, CloudflareAccount, KeitaroTracker } from '../types.ts';
import { Plus, Edit2, Trash2, X, AlertTriangle } from 'lucide-react';

export default function Integrations() {
  const [data, setData] = useState<{
    namecheap: NamecheapAccount[];
    cloudflare: CloudflareAccount[];
    keitaro: KeitaroTracker[];
    groups: any[];
  } | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState('namecheap');
  const [formData, setFormData] = useState<any>({});
  
  const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; table: string; id: number | null }>({ isOpen: false, table: '', id: null });

  const fetchData = () => {
    fetch('/api/integrations')
      .then(res => res.json())
      .then(setData);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const confirmDelete = async () => {
    if (deleteModal.id === null) return;
    await fetch(`/api/crud/${deleteModal.table}/${deleteModal.id}`, { method: 'DELETE' });
    setDeleteModal({ isOpen: false, table: '', id: null });
    fetchData();
  };

  const handleSave = async () => {
    let table = '';
    if (modalType === 'namecheap') table = 'namecheap_accounts';
    if (modalType === 'cloudflare') table = 'cloudflare_accounts';
    if (modalType === 'keitaro') table = 'keitaro_trackers';
    if (modalType === 'group') table = 'integration_groups';

    const method = formData.id ? 'PUT' : 'POST';
    const url = formData.id ? `/api/crud/${table}/${formData.id}` : `/api/crud/${table}`;
    
    const body = { ...formData };
    delete body.id;
    
    // defaults
    if (!body.status && modalType !== 'group') body.status = 'ACTIVE';

    await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    setModalOpen(false);
    fetchData();
  };

  const openAdd = () => {
    setFormData({});
    setModalOpen(true);
  };

  const openEdit = (type: string, item: any) => {
    setModalType(type);
    setFormData(item);
    setModalOpen(true);
  };

  const renderInput = (label: string, field: string, type = 'text') => (
    <div className="mb-4">
      <label className="block text-xs text-white/50 mb-1.5">{label}</label>
      <input 
        type={type}
        value={formData[field] || ''}
        onChange={(e) => setFormData({ ...formData, [field]: e.target.value })}
        className="w-full bg-black/20 border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:border-[#FFBC03]"
      />
    </div>
  );

  const renderSelect = (label: string, field: string, options: any[]) => (
    <div className="mb-4">
      <label className="block text-xs text-white/50 mb-1.5">{label}</label>
      <select
        value={formData[field] || ''}
        onChange={(e) => setFormData({ ...formData, [field]: e.target.value ? Number(e.target.value) : null })}
        className="w-full bg-black/20 border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:border-[#FFBC03] appearance-none"
      >
        <option value="">Без группы</option>
        {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </div>
  );

  return (
    <div className="p-8 h-full overflow-auto relative">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight mb-1">Интеграции</h1>
          <p className="text-sm text-white/50">Управление подключенными сервисами</p>
        </div>
        <button onClick={openAdd} className="bg-[#FFBC03] text-[#212121] px-4 py-2 rounded-lg font-medium text-sm flex items-center gap-2 hover:bg-[#FFBC03]/90 transition-colors">
          <Plus className="w-4 h-4" />
          Добавить
        </button>
      </div>

      {!data ? (
        <div className="text-white/40">Загрузка...</div>
      ) : (
        <div className="space-y-8 pb-10">
          <section>
            <h2 className="text-lg font-medium mb-4">Группы интеграций</h2>
            {data.groups.length === 0 ? (
              <div className="text-sm text-white/40 bg-white/5 border border-white/10 rounded-xl p-4 text-center">
                Нет добавленных групп
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {data.groups.map(group => (
                  <div key={group.id} className="bg-white/5 border border-white/10 rounded-xl p-4 group/card relative">
                    <div className="absolute top-2 right-2 opacity-0 group-hover/card:opacity-100 transition-opacity flex items-center gap-1">
                      <button onClick={() => openEdit('group', group)} className="p-1.5 hover:bg-white/10 rounded text-white/60 hover:text-white transition-colors">
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setDeleteModal({ isOpen: true, table: 'integration_groups', id: group.id })} className="p-1.5 hover:bg-rose-500/20 rounded text-white/60 hover:text-rose-400 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="font-medium text-lg text-[#FFBC03]">{group.name}</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="text-lg font-medium mb-4">Namecheap Аккаунты</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {data.namecheap.map(acc => (
                <div key={acc.id} className="bg-white/5 border border-white/10 rounded-xl p-4 group/card relative">
                  <div className="absolute top-2 right-2 opacity-0 group-hover/card:opacity-100 transition-opacity flex items-center gap-1">
                    <button onClick={() => openEdit('namecheap', acc)} className="p-1.5 hover:bg-white/10 rounded text-white/60 hover:text-white transition-colors">
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setDeleteModal({ isOpen: true, table: 'namecheap_accounts', id: acc.id })} className="p-1.5 hover:bg-rose-500/20 rounded text-white/60 hover:text-rose-400 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="font-medium">{acc.name}</div>
                  <div className="text-sm text-white/50 mt-1">{acc.username}</div>
                  <div className="mt-4 flex justify-between items-center">
                    <span className="text-xs bg-emerald-500/10 text-emerald-400 px-2 py-1 rounded">{acc.status}</span>
                    <span className="text-sm font-medium">${acc.balance?.toFixed(2) || '0.00'}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-lg font-medium mb-4">Cloudflare Аккаунты</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {data.cloudflare.map(acc => (
                <div key={acc.id} className="bg-white/5 border border-white/10 rounded-xl p-4 group/card relative">
                  <div className="absolute top-2 right-2 opacity-0 group-hover/card:opacity-100 transition-opacity flex items-center gap-1">
                    <button onClick={() => openEdit('cloudflare', acc)} className="p-1.5 hover:bg-white/10 rounded text-white/60 hover:text-white transition-colors">
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setDeleteModal({ isOpen: true, table: 'cloudflare_accounts', id: acc.id })} className="p-1.5 hover:bg-rose-500/20 rounded text-white/60 hover:text-rose-400 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="font-medium">{acc.name}</div>
                  <div className="text-sm text-white/50 mt-1">{acc.email || 'Нет Email'}</div>
                  <div className="mt-4">
                    <span className="text-xs bg-emerald-500/10 text-emerald-400 px-2 py-1 rounded">{acc.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-lg font-medium mb-4">Keitaro Трекеры</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {data.keitaro.map(acc => (
                <div key={acc.id} className="bg-white/5 border border-white/10 rounded-xl p-4 group/card relative">
                  <div className="absolute top-2 right-2 opacity-0 group-hover/card:opacity-100 transition-opacity flex items-center gap-1">
                    <button onClick={() => openEdit('keitaro', acc)} className="p-1.5 hover:bg-white/10 rounded text-white/60 hover:text-white transition-colors">
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setDeleteModal({ isOpen: true, table: 'keitaro_trackers', id: acc.id })} className="p-1.5 hover:bg-rose-500/20 rounded text-white/60 hover:text-rose-400 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="font-medium">{acc.name}</div>
                  <div className="text-sm text-white/50 mt-1 truncate">{acc.url}</div>
                  <div className="mt-4">
                    <span className="text-xs bg-emerald-500/10 text-emerald-400 px-2 py-1 rounded">{acc.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-[#212121] border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between p-4 border-b border-white/5">
              <h3 className="font-medium">{formData.id ? 'Редактировать' : 'Добавить'}</h3>
              <button onClick={() => setModalOpen(false)} className="text-white/40 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            
            <div className="p-5">
              {!formData.id && (
                <div className="flex gap-2 mb-6 p-1 bg-black/20 rounded-lg">
                  {['namecheap', 'cloudflare', 'keitaro', 'group'].map(type => (
                    <button
                      key={type}
                      onClick={() => { setModalType(type); setFormData({}); }}
                      className={`flex-1 text-xs font-medium py-1.5 rounded transition-colors ${modalType === type ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/80'}`}
                    >
                      {type === 'namecheap' ? 'NC' : type === 'cloudflare' ? 'CF' : type === 'keitaro' ? 'Keitaro' : 'Группа'}
                    </button>
                  ))}
                </div>
              )}

              {modalType === 'group' && (
                <>
                  {renderInput('Название группы', 'name')}
                </>
              )}

              {modalType === 'namecheap' && (
                <>
                  {renderInput('Название (алиас)', 'name')}
                  {renderSelect('Группа', 'group_id', data?.groups || [])}
                  {renderInput('Username', 'username')}
                  {renderInput('API User', 'api_user')}
                  {renderInput('API Key', 'api_key', 'password')}
                  {renderInput('Client IP', 'client_ip')}
                </>
              )}

              {modalType === 'cloudflare' && (
                <>
                  {renderInput('Название (алиас)', 'name')}
                  {renderSelect('Группа', 'group_id', data?.groups || [])}
                  {renderInput('Email (опционально)', 'email')}
                  {renderInput('API Token', 'api_token', 'password')}
                </>
              )}

              {modalType === 'keitaro' && (
                <>
                  {renderInput('Название (алиас)', 'name')}
                  {renderSelect('Группа', 'group_id', data?.groups || [])}
                  {renderInput('URL', 'url')}
                  {renderInput('API Key', 'api_key', 'password')}
                  {renderInput('IP сервера', 'server_ip')}
                </>
              )}

              <div className="mt-6 flex justify-end gap-3">
                <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm text-white/60 hover:text-white">Отмена</button>
                <button onClick={handleSave} className="bg-[#FFBC03] text-[#212121] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#FFBC03]/90 transition-colors">Сохранить</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {deleteModal.isOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-[#212121] border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between p-4 border-b border-white/5">
              <h3 className="font-medium text-rose-400 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Подтверждение удаления
              </h3>
              <button onClick={() => setDeleteModal({ isOpen: false, table: '', id: null })} className="text-white/40 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            
            <div className="p-5">
              <p className="text-white/70 text-sm mb-6">
                Вы уверены, что хотите удалить эту интеграцию? Это действие нельзя отменить.
              </p>

              <div className="flex justify-end gap-3">
                <button onClick={() => setDeleteModal({ isOpen: false, table: '', id: null })} className="px-4 py-2 text-sm text-white/60 hover:text-white">Отмена</button>
                <button onClick={confirmDelete} className="bg-rose-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-rose-600 transition-colors">Удалить</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
