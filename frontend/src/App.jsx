import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Menu } from 'lucide-react';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import Settings from './components/Settings';
import Upload from './components/Upload';
import Users from './components/Users';
import Login from './components/Login';
import History from './components/History';
import SetupPage from './components/SetupPage';
import LiveActivity from './components/LiveActivity';
import DailyFailures from './components/DailyFailures';

function App() {
    const [token, setToken] = useState(localStorage.getItem('token'));
    const [user, setUser] = useState(null);
    const [activeTab, setActiveTab] = useState('dashboard');
    const [isConfigured, setIsConfigured] = useState(null);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    useEffect(() => {
        // Verifica se a empresa já está configurada
        axios.get('/api/setup/status')
            .then(res => setIsConfigured(res.data.configured))
            .catch(() => setIsConfigured(false));
    }, []);

    useEffect(() => {
        if (token) {
            axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
            if (!user) fetchUser();
        } else {
            delete axios.defaults.headers.common['Authorization'];
        }
    }, [token]);

    const fetchUser = async () => {
        try {
            const response = await axios.get('/api/users/me');
            setUser(response.data);
        } catch (e) {
            handleLogout();
        }
    };

    const handleLogin = (userData) => {
        setToken(localStorage.getItem('token'));
        setUser(userData);
    };

    const handleLogout = () => {
        localStorage.removeItem('token');
        setToken(null);
        setUser(null);
    };

    if (isConfigured === null) {
        return <div className="flex h-screen items-center justify-center bg-dark-900 font-sans text-lime-400">Verificando sistema...</div>;
    }

    if (isConfigured === false) {
        return <SetupPage onSetupComplete={() => setIsConfigured(true)} />;
    }

    if (!token) {
        return <Login onLogin={handleLogin} />;
    }

    const renderContent = () => {
        switch (activeTab) {
            case 'dashboard':
                return <Dashboard token={token} />;
            case 'settings':
                return <Settings token={token} />;
            case 'upload':
                return <Upload token={token} onStart={() => setActiveTab('dashboard')} />;
            case 'users':
                return <Users token={token} />;
            case 'history':
                return <History token={token} />;
            case 'live':
                return <LiveActivity token={token} />;
            case 'failures':
                return <DailyFailures token={token} />;
            default:
                return <Dashboard token={token} />;
        }
    };

    return (
        <div className="flex h-screen bg-dark-900 text-white overflow-hidden font-sans antialiased selection:bg-lime-500/30">
            <Sidebar
                activeTab={activeTab}
                setActiveTab={(tab) => {
                    setActiveTab(tab);
                    setIsSidebarOpen(false); // Close sidebar on mobile when navigating
                }}
                user={user}
                onLogout={handleLogout}
                isOpen={isSidebarOpen}
                setIsOpen={setIsSidebarOpen}
            />

            <main className="flex-1 flex flex-col h-full overflow-hidden relative w-full">
                <div className="absolute inset-0 bg-gradient-to-br from-lime-500/5 to-transparent pointer-events-none" />

                {/* Mobile Header */}
                <header className="md:hidden flex items-center justify-between p-4 bg-dark-800 border-b border-dark-700 relative z-40">
                    <button
                        onClick={() => setIsSidebarOpen(true)}
                        className="p-2 -ml-2 text-gray-400 hover:text-white rounded-lg hover:bg-dark-700 transition-colors"
                    >
                        <Menu size={24} />
                    </button>
                    <div className="font-bold text-lg bg-gradient-to-r from-lime-400 to-emerald-400 bg-clip-text text-transparent">
                        Disparador
                    </div>
                    <div className="w-8"></div> {/* Spacer for centering */}
                </header>

                <div className="flex-1 overflow-y-auto relative w-full">
                    {renderContent()}
                </div>
            </main>
        </div>
    );
}

export default App;
