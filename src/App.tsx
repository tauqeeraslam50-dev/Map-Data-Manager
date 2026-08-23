import React, { useState } from 'react';
import UploadManager from './components/UploadManager';
import MapViewer from './components/MapViewer';
import { Database, Map as MapIcon, Settings, Signal, Menu } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<'map' | 'data'>('map');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="flex flex-col h-screen w-full bg-slate-50 text-slate-900 overflow-hidden font-sans">
      {/* Top Navbar */}
      <nav className="h-14 bg-blue-900 text-white flex items-center justify-between px-6 shrink-0 shadow-md">
        <div className="flex items-center space-x-4">
          <div className="w-8 h-8 bg-blue-500 rounded flex items-center justify-center font-bold">RF</div>
          <h1 className="text-lg font-semibold tracking-tight">PakLink | <span className="font-normal text-blue-200">Offline Map Manager v2.4</span></h1>
        </div>
        <div className="hidden md:flex items-center space-x-6 text-sm font-medium">
          <div className="flex items-center text-green-400">
            <div className="w-2 h-2 rounded-full bg-green-400 mr-2 animate-pulse"></div>
            OFFLINE ENGINE ACTIVE
          </div>
          <div className="text-blue-100">LOCAL CACHE: SECURE</div>
          <button className="bg-blue-700 px-4 py-1.5 rounded hover:bg-blue-600 border border-blue-400 flex items-center gap-2 transition-colors">
            <Settings className="w-4 h-4" />
            System Settings
          </button>
        </div>
        <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="md:hidden p-2 text-blue-100 hover:text-white">
          <Menu className="w-6 h-6" />
        </button>
      </nav>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className={`
          ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} 
          md:translate-x-0 fixed md:relative z-50 w-72 h-full bg-white border-r border-slate-200 flex flex-col transition-transform duration-300 ease-in-out
        `}>
          <div className="p-4 border-b border-slate-100 bg-slate-50">
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Active Modules</h2>
          </div>
          
          <div className="flex-1 p-4 space-y-2 overflow-y-auto">
            <button
              onClick={() => { setActiveTab('map'); setMobileMenuOpen(false); }}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors border ${
                activeTab === 'map' ? 'bg-blue-50 border-blue-200 text-blue-700 font-semibold shadow-sm' : 'border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <MapIcon className={`w-5 h-5 ${activeTab === 'map' ? 'text-blue-600' : 'text-slate-400'}`} />
              <span>Field Map</span>
            </button>
            
            <button
              onClick={() => { setActiveTab('data'); setMobileMenuOpen(false); }}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors border ${
                activeTab === 'data' ? 'bg-blue-50 border-blue-200 text-blue-700 font-semibold shadow-sm' : 'border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <Database className={`w-5 h-5 ${activeTab === 'data' ? 'text-blue-600' : 'text-slate-400'}`} />
              <span>Data Manager</span>
            </button>
          </div>
          
          <div className="p-4 border-t border-slate-200">
            <div className="bg-slate-900 text-white p-4 rounded-xl text-center space-y-2 shadow-inner">
              <p className="text-[10px] opacity-70 tracking-widest uppercase">Database Status</p>
              <p className="font-mono text-xs text-green-400 font-semibold">IndexedDB Connected</p>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 relative bg-slate-200 p-4 overflow-hidden flex flex-col">
          {activeTab === 'map' && <MapViewer />}
          {activeTab === 'data' && <UploadManager />}
        </main>
        
        {/* Mobile overlay */}
        {mobileMenuOpen && (
          <div 
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 md:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}
      </div>

      {/* Footer */}
      <footer className="h-8 bg-slate-100 border-t border-slate-200 flex items-center px-4 justify-between text-[10px] text-slate-500 font-mono shrink-0">
        <div className="flex space-x-4">
          <span className="flex items-center"><div className="w-1.5 h-1.5 rounded-full bg-green-500 mr-1.5"></div> MAP ENGINE: OK</span>
          <span>STORAGE: IDB</span>
        </div>
        <div>PAKISTAN NATIONAL RF MAPPING UTILITY • SECURE FIELD ACCESS ONLY</div>
      </footer>
    </div>
  );
}
