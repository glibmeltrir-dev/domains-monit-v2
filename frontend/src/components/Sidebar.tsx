import { Link, useLocation } from 'react-router-dom';
import { Globe, PlusCircle, RefreshCcw, Network, LayoutTemplate, Settings, LogOut } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../auth.tsx';

export default function Sidebar() {
  const location = useLocation();
  const { user, logout } = useAuth();

  const links = [
    { name: 'Домены', icon: Globe, path: '/domains' },
    { name: 'Покупка', icon: PlusCircle, path: '/purchase' },
    { name: 'Замена', icon: RefreshCcw, path: '/replace' },
    { name: 'Интеграции', icon: Network, path: '/integrations' },
    { name: 'Шаблоны', icon: LayoutTemplate, path: '/templates' },
    { name: 'Настройки', icon: Settings, path: '/settings' },
  ];

  return (
    <div className="w-64 h-full flex flex-col py-6 px-4">
      <div className="flex items-center gap-3 px-2 mb-10">
        <div className="w-8 h-8 rounded-lg bg-[#FFBC03] flex items-center justify-center">
          <Globe className="w-5 h-5 text-[#212121]" strokeWidth={2.5} />
        </div>
        <span className="text-xl font-bold tracking-tight">DomainOps</span>
      </div>

      <nav className="flex-1 flex flex-col gap-2">
        {links.map((link) => {
          const Icon = link.icon;
          const isActive = location.pathname.startsWith(link.path);
          return (
            <Link
              key={link.path}
              to={link.path}
              className={clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors',
                isActive 
                  ? 'bg-white/10 text-white' 
                  : 'text-white/60 hover:text-white hover:bg-white/5'
              )}
            >
              <Icon className={clsx("w-5 h-5", isActive ? "text-[#FFBC03]" : "text-white/40")} />
              {link.name}
            </Link>
          );
        })}
      </nav>

      <div className="mt-4 pt-4 border-t border-white/10">
        <div className="px-3 mb-2 text-xs text-white/40 truncate" title={user?.role}>
          {user?.username}
          {user?.role === 'super_admin' && <span className="ml-1 text-[#FFBC03]">admin</span>}
        </div>
        <button
          onClick={() => logout()}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-white/60 hover:text-white hover:bg-white/5 transition-colors"
        >
          <LogOut className="w-5 h-5 text-white/40" />
          Выйти
        </button>
      </div>
    </div>
  );
}
