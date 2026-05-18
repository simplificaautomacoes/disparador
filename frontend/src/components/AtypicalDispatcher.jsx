import React, { useState } from 'react';
import { Settings, Rocket, ClipboardList } from 'lucide-react';
import TemplatesConfig from './atypical/TemplatesConfig';
import NewDispatch from './atypical/NewDispatch';
import TasksList from './atypical/TasksList';

const AtypicalDispatcher = () => {
    const [subTab, setSubTab] = useState('tasks');

    const tabs = [
        { id: 'config', icon: Settings, label: 'Configuração' },
        { id: 'dispatch', icon: Rocket, label: 'Novo Disparo' },
        { id: 'tasks', icon: ClipboardList, label: 'Tarefas' },
    ];

    return (
        <div className="p-4 md:p-8 space-y-6">
            <header>
                <h2 className="text-3xl font-bold text-white">Disparador Atípico</h2>
                <p className="text-gray-400 mt-1">Disparos independentes com anotação personalizada e agendamento</p>
            </header>

            {/* Sub-tabs */}
            <div className="flex gap-2 bg-dark-800 p-1.5 rounded-xl border border-dark-700 w-fit">
                {tabs.map(tab => {
                    const Icon = tab.icon;
                    const isActive = subTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setSubTab(tab.id)}
                            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                                isActive
                                    ? 'bg-lime-500 text-dark-900 shadow-lg shadow-lime-500/20'
                                    : 'text-gray-400 hover:text-white hover:bg-dark-700'
                            }`}
                        >
                            <Icon size={16} />
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            {/* Content */}
            {subTab === 'config' && <TemplatesConfig />}
            {subTab === 'dispatch' && <NewDispatch />}
            {subTab === 'tasks' && <TasksList />}
        </div>
    );
};

export default AtypicalDispatcher;
