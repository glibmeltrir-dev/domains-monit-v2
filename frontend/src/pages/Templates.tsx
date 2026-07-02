import { useEffect, useState } from 'react';
import { CloudflareTemplate } from '../types.ts';
import { Plus, Edit2, Trash2, X, AlertTriangle } from 'lucide-react';

export default function Templates() {
  const [templates, setTemplates] = useState<CloudflareTemplate[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [formData, setFormData] = useState<any>({});
  const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; id: number | null }>({ isOpen: false, id: null });

  const fetchData = () => {
    fetch('/api/templates')
      .then(res => res.json())
      .then(setTemplates);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const confirmDelete = async () => {
    if (deleteModal.id === null) return;
    await fetch(`/api/crud/cloudflare_templates/${deleteModal.id}`, { method: 'DELETE' });
    setDeleteModal({ isOpen: false, id: null });
    fetchData();
  };

  const handleSave = async () => {
    const method = formData.id ? 'PUT' : 'POST';
    const url = formData.id ? `/api/crud/cloudflare_templates/${formData.id}` : `/api/crud/cloudflare_templates`;
    
    const body = { ...formData };
    delete body.id;
    
    body.proxy_on = body.proxy_on ? 1 : 0;
    body.bot_fight_mode = body.bot_fight_mode ? 1 : 0;
    body.https_redirect = body.https_redirect ? 1 : 0;
    if (!body.ssl_mode) body.ssl_mode = 'Off';

    await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    setModalOpen(false);
    fetchData();
  };

  const openAdd = () => {
    setFormData({ proxy_on: 1, bot_fight_mode: 0, https_redirect: 1, ssl_mode: 'Full' });
    setModalOpen(true);
  };

  const openEdit = (item: any) => {
    setFormData({
      ...item,
      proxy_on: !!item.proxy_on,
      bot_fight_mode: !!item.bot_fight_mode,
      https_redirect: !!item.https_redirect
    });
    setModalOpen(true);
  };

  return (
    <div className="p-8 h-full overflow-auto relative">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight mb-1">Шаблоны Cloudflare</h1>
          <p className="text-sm text-white/50">Настройки для автоматического применения при покупке</p>
        </div>
        <button onClick={openAdd} className="bg-[#FFBC03] text-[#212121] px-4 py-2 rounded-lg font-medium text-sm flex items-center gap-2 hover:bg-[#FFBC03]/90 transition-colors">
          <Plus className="w-4 h-4" />
          Создать шаблон
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-10">
        {templates.map(template => (
          <div key={template.id} className="bg-white/5 border border-white/10 rounded-xl p-5 hover:bg-white/[0.07] transition-colors group relative">
            <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
              <button onClick={() => openEdit(template)} className="p-1.5 hover:bg-white/10 rounded text-white/60 hover:text-white transition-colors">
                <Edit2 className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setDeleteModal({ isOpen: true, id: template.id })} className="p-1.5 hover:bg-rose-500/20 rounded text-white/60 hover:text-rose-400 transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            
            <h3 className="text-lg font-medium mb-4 pr-16">{template.name}</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-white/50">Proxy</span>
                <span className={template.proxy_on ? 'text-amber-400' : 'text-white/70'}>
                  {template.proxy_on ? 'ON (Оранжевое облако)' : 'OFF (Серое облако)'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/50">SSL/TLS</span>
                <span>{template.ssl_mode}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/50">Bot Fight Mode</span>
                <span className={template.bot_fight_mode ? 'text-emerald-400' : 'text-white/70'}>
                  {template.bot_fight_mode ? 'ON' : 'OFF'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/50">HTTPS Redirect</span>
                <span className={template.https_redirect ? 'text-emerald-400' : 'text-white/70'}>
                  {template.https_redirect ? 'ON' : 'OFF'}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {deleteModal.isOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-[#212121] border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between p-4 border-b border-white/5">
              <h3 className="font-medium text-rose-400 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Подтверждение удаления
              </h3>
              <button onClick={() => setDeleteModal({ isOpen: false, id: null })} className="text-white/40 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            
            <div className="p-5">
              <p className="text-white/70 text-sm mb-6">
                Вы уверены, что хотите удалить этот шаблон? Это действие нельзя отменить.
              </p>

              <div className="flex justify-end gap-3">
                <button onClick={() => setDeleteModal({ isOpen: false, id: null })} className="px-4 py-2 text-sm text-white/60 hover:text-white">Отмена</button>
                <button onClick={confirmDelete} className="bg-rose-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-rose-600 transition-colors">Удалить</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-[#212121] border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between p-4 border-b border-white/5">
              <h3 className="font-medium">{formData.id ? 'Редактировать шаблон' : 'Новый шаблон'}</h3>
              <button onClick={() => setModalOpen(false)} className="text-white/40 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs text-white/50 mb-1.5">Название шаблона</label>
                <input 
                  type="text"
                  value={formData.name || ''}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full bg-black/20 border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:border-[#FFBC03]"
                />
              </div>

              <div>
                <label className="block text-xs text-white/50 mb-1.5">SSL Mode</label>
                <select 
                  value={formData.ssl_mode || 'Off'}
                  onChange={(e) => setFormData({ ...formData, ssl_mode: e.target.value })}
                  className="w-full bg-black/20 border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:border-[#FFBC03] appearance-none"
                >
                  <option value="Off">Off</option>
                  <option value="Flexible">Flexible</option>
                  <option value="Full">Full</option>
                  <option value="Full (Strict)">Full (Strict)</option>
                </select>
              </div>

              <div className="pt-2 space-y-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={formData.proxy_on || false}
                    onChange={(e) => setFormData({ ...formData, proxy_on: e.target.checked })}
                    className="rounded border-white/20 bg-transparent accent-[#FFBC03]" 
                  />
                  <span className="text-sm">Proxy ON (Оранжевое облако)</span>
                </label>
                
                <label className="flex items-center gap-3 cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={formData.https_redirect || false}
                    onChange={(e) => setFormData({ ...formData, https_redirect: e.target.checked })}
                    className="rounded border-white/20 bg-transparent accent-[#FFBC03]" 
                  />
                  <span className="text-sm">Always Use HTTPS (Redirect)</span>
                </label>

                <label className="flex items-center gap-3 cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={formData.bot_fight_mode || false}
                    onChange={(e) => setFormData({ ...formData, bot_fight_mode: e.target.checked })}
                    className="rounded border-white/20 bg-transparent accent-[#FFBC03]" 
                  />
                  <span className="text-sm">Bot Fight Mode</span>
                </label>
              </div>

              <div className="mt-6 flex justify-end gap-3 pt-4">
                <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm text-white/60 hover:text-white">Отмена</button>
                <button onClick={handleSave} className="bg-[#FFBC03] text-[#212121] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#FFBC03]/90 transition-colors">Сохранить</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
