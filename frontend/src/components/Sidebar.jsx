import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { LayoutDashboard, Settings, Upload, Phone, LogOut, History, Building2, Sun, Moon, Activity, XCircle, X, Zap } from 'lucide-react';

const Sidebar = ({ activeTab, setActiveTab, user, onLogout, isOpen, setIsOpen }) => {
    const [companyInfo, setCompanyInfo] = useState({ name: 'Disparador', hasLogo: false });
    const [isLightMode, setIsLightMode] = useState(() => {
        return localStorage.getItem('theme') === 'light' || window.document.body.classList.contains('light-mode');
    });

    useEffect(() => {
        if (isLightMode) {
            window.document.body.classList.add('light-mode');
            localStorage.setItem('theme', 'light');
        } else {
            window.document.body.classList.remove('light-mode');
            localStorage.setItem('theme', 'dark');
        }
    }, [isLightMode]);

    const toggleTheme = () => {
        setIsLightMode(prev => !prev);
    };

    useEffect(() => {
        axios.get('/api/setup/status').then(res => {
            if (res.data.configured) {
                setCompanyInfo({
                    name: res.data.company_name || 'Disparador',
                    hasLogo: !!res.data.logo_path
                });
            }
        }).catch(() => { });
    }, []);
    const menuItems = [
        { id: 'dashboard', icon: LayoutDashboard, label: 'Painel' },
        { id: 'live', icon: Activity, label: 'Ao Vivo' },
        { id: 'history', icon: History, label: 'Histórico' },
        { id: 'failures', icon: XCircle, label: 'Falhas do Dia' },
        { id: 'upload', icon: Upload, label: 'Upload & Disparar' },
        { id: 'settings', icon: Settings, label: 'Configurações' },
        { id: 'atypical', icon: Zap, label: 'Atípico' },
    ];

    return (
        <>
            {/* Mobile Backdrop Overlay */}
            {isOpen && (
                <div
                    className="fixed inset-0 bg-black/60 z-40 md:hidden backdrop-blur-sm transition-opacity"
                    onClick={() => setIsOpen(false)}
                />
            )}

            <div className={`fixed inset-y-0 left-0 z-50 w-72 md:w-64 bg-dark-800 text-white flex flex-col border-r border-dark-700 transform transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : '-translate-x-full'} md:relative md:translate-x-0`}>
                <div className="p-6 flex items-center justify-between md:justify-center border-b border-dark-700/50 min-h-[100px]">
                    <div className="flex items-center justify-center flex-1">
                        {companyInfo.hasLogo ? (
                            <img src="/api/config/logo" alt="Logo da Empresa" className="h-16 max-w-[200px] object-contain rounded drop-shadow-md" />
                        ) : (
                            <>
                                <div className="bg-lime-500 p-2 rounded-lg flex items-center justify-center flex-shrink-0">
                                    <Building2 size={24} className="text-dark-900" />
                                </div>
                                <h1 className="text-xl font-bold tracking-tight truncate ml-3" title={companyInfo.name}>
                                    {companyInfo.name}
                                </h1>
                            </>
                        )}
                    </div>
                    {/* Mobile Close Button */}
                    <button
                        className="md:hidden p-2 -mr-2 text-gray-400 hover:text-white rounded-lg hover:bg-dark-700"
                        onClick={() => setIsOpen(false)}
                    >
                        <X size={24} />
                    </button>
                </div>

                <nav className="flex-1 px-4 py-4 space-y-2">
                    {menuItems.map((item) => {
                        const Icon = item.icon;
                        const isActive = activeTab === item.id;
                        return (
                            <button
                                key={item.id}
                                onClick={() => setActiveTab(item.id)}
                                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${isActive
                                    ? 'bg-lime-500 text-dark-900 font-semibold shadow-lg shadow-lime-500/20'
                                    : 'text-gray-400 hover:bg-dark-700 hover:text-white'
                                    }`}
                            >
                                <Icon size={20} />
                                <span>{item.label}</span>
                            </button>
                        );
                    })}
                </nav>

                <div className="p-6 border-t border-dark-700">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-lime-400 to-green-600 flex items-center justify-center text-dark-900 font-bold text-xs uppercase">
                            {user?.email?.charAt(0) || 'U'}
                        </div>
                        <div className="flex-1 overflow-hidden">
                            {user?.role === 'admin' && (
                                <button onClick={() => setActiveTab('users')} className="text-sm font-medium hover:text-lime-400 text-left w-full truncate">
                                    Gerenciar Usuários
                                </button>
                            )}
                            <p className="text-xs text-gray-400 truncate">{user?.email}</p>
                        </div>
                        <button onClick={toggleTheme} className="text-gray-500 hover:text-white transition-colors" title="Alternar Tema">
                            {isLightMode ? <Moon size={18} /> : <Sun size={18} />}
                        </button>
                        <button onClick={onLogout} className="text-gray-500 hover:text-red-500 transition-colors ml-1" title="Sair">
                            <LogOut size={16} />
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
};

export default Sidebar;
