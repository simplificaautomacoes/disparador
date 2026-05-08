import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Calendar, CheckCircle, XCircle, ChevronDown, ChevronRight } from 'lucide-react';

const History = ({ token }) => {
    const [history, setHistory] = useState({});
    const [loading, setLoading] = useState(true);
    const [expandedDates, setExpandedDates] = useState({});

    useEffect(() => {
        fetchHistory();
    }, []);

    const fetchHistory = async () => {
        try {
            const res = await axios.get('/api/history');
            setHistory(res.data);
            // Auto expand first date
            const firstDate = Object.keys(res.data)[0];
            if (firstDate) {
                setExpandedDates({ [firstDate]: true });
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const toggleDate = (date) => {
        setExpandedDates(prev => ({
            ...prev,
            [date]: !prev[date]
        }));
    };

    if (loading) return <div>Carregando histórico...</div>;

    const sortedDates = Object.keys(history).sort((a, b) => new Date(b) - new Date(a));

    return (
        <div className="p-8 space-y-8 pb-20">
            <header>
                <h2 className="text-3xl font-bold text-white">Histórico de Envios</h2>
                <p className="text-gray-400 mt-1">Acompanhe o desempenho diário por remetente</p>
            </header>

            <div className="space-y-4">
                {sortedDates.map(date => (
                    <div key={date} className="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden">
                        <button
                            onClick={() => toggleDate(date)}
                            className="w-full flex items-center justify-between p-4 bg-dark-700/50 hover:bg-dark-700 transition"
                        >
                            <div className="flex items-center gap-3">
                                {expandedDates[date] ? <ChevronDown size={20} className="text-lime-500" /> : <ChevronRight size={20} className="text-gray-500" />}
                                <div className="flex items-center gap-2">
                                    <Calendar size={18} className="text-gray-400" />
                                    <span className="font-mono text-lg text-white font-medium">
                                        {new Date(date).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}
                                    </span>
                                </div>
                            </div>
                            <div className="flex gap-4 text-sm">
                                <span className="flex items-center gap-1 text-green-400">
                                    <CheckCircle size={14} />
                                    {Object.values(history[date]).reduce((acc, curr) => acc + curr.success, 0)}
                                </span>
                                <span className="flex items-center gap-1 text-red-400">
                                    <XCircle size={14} />
                                    {Object.values(history[date]).reduce((acc, curr) => acc + curr.failed, 0)}
                                </span>
                            </div>
                        </button>

                        {expandedDates[date] && (
                            <div className="p-4 border-t border-dark-700">
                                <div className="grid gap-3">
                                    {Object.entries(history[date]).map(([senderId, stats]) => (
                                        <div key={senderId} className="flex flex-col md:flex-row md:items-center justify-between bg-dark-900 p-3 rounded-lg border border-dark-700/50">
                                            <div className="mb-2 md:mb-0">
                                                <h4 className="font-bold text-white">{stats.name}</h4>
                                                <p className="text-xs text-gray-500 font-mono truncate max-w-[200px]">{senderId}</p>
                                            </div>
                                            <div className="flex gap-6">
                                                <div className="flex flex-col items-end">
                                                    <span className="text-xs text-gray-400 uppercase">Sucessos</span>
                                                    <span className="text-green-400 font-mono font-bold text-lg">{stats.success}</span>
                                                </div>
                                                <div className="flex flex-col items-end">
                                                    <span className="text-xs text-gray-400 uppercase">Falhas</span>
                                                    <span className="text-red-400 font-mono font-bold text-lg">{stats.failed}</span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                ))}

                {sortedDates.length === 0 && (
                    <div className="text-center py-20 text-gray-500">
                        Nenhum histórico encontrado.
                    </div>
                )}
            </div>
        </div>
    );
};

export default History;
