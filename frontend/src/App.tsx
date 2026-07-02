/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar.tsx';
import Domains from './pages/Domains.tsx';
import Integrations from './pages/Integrations.tsx';
import Templates from './pages/Templates.tsx';
import Purchase from './pages/Purchase.tsx';
import Replace from './pages/Replace.tsx';
import Settings from './pages/Settings.tsx';

export default function App() {
  return (
    <Router>
      <div className="flex h-screen bg-[#212121] text-white">
        <Sidebar />
        <main className="flex-1 overflow-auto bg-[#1a1a1a] m-2 rounded-2xl border border-white/10 shadow-xl">
          <Routes>
            <Route path="/" element={<Navigate to="/domains" replace />} />
            <Route path="/domains" element={<Domains />} />
            <Route path="/purchase" element={<Purchase />} />
            <Route path="/replace" element={<Replace />} />
            <Route path="/integrations" element={<Integrations />} />
            <Route path="/templates" element={<Templates />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}
