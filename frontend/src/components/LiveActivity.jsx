import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Activity, User, Phone, Play, Square, Loader, Clock } from 'lucide-react';
import { motion } from 'framer-motion';

const LiveActivity = () => {
    const [statuses, setStatuses] = useState([]);
    const [loading, setLoading] = useState(true);

    const fetchStatus = async () => {
        try {
            const response = await axios.get('/api/live_status');
            setStatuses(response.data);
            setLoading(false);
        } catch (error) {
            console.error("Erro ao buscar status:", error);
        }
    };

    useEffect(() => {
        fetchStatus();
        const interval = setInterval(fetchStatus, 2000);
        return () => clearInterval(interval);
    }, []);

    if (loading) {
        return (
            <div className="p-8 flex items-center justify-center h-full">
                <Loader className="animate-spin text-lime-500" size={32} />
            </div>
        );
    }

    return (
        <div className="p-8 pb-32 max-w-7xl mx-auto h-full overflow-y-auto">
            <header className="mb-8">
                <div>
                    <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent flex items-center gap-3">
                        <Activity size={32} className="text-lime-500" />
                        Atividade Ao Vivo
                    </h1>
                    <p className="text-gray-400 mt-2">Monitoramento global em tempo real da engine de disparo das contas ativas.</p>
                </div>
            </header>

            <div className="bg-dark-800 rounded-2xl border border-dark-700 p-8 shadow-xl relative overflow-hidden">
                {statuses.length > 0 ? (
                    <div className="space-y-12">
                        {statuses.map((status, index) => {
                            const isCompleted = status?.current_action?.includes("Concluído") || status?.current_action?.includes("Parado");
                            if (!status?.is_running && isCompleted && index !== 0) return null; // Hide finished ones unless it's the only one

                            return (
                                <motion.div key={index} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
                                    <div className="flex items-center justify-between bg-dark-900 border border-lime-500/30 p-6 rounded-xl relative overflow-hidden">
                                        <div className="absolute top-0 left-0 h-full w-1 bg-lime-500"></div>
                                        <div className="flex items-center gap-4">
                                            <div className="w-12 h-12 rounded-full bg-lime-500/20 flex items-center justify-center">
                                                <Activity className="text-lime-500 animate-pulse" size={24} />
                                            </div>
                                            <div>
                                                <h3 className="text-xl font-bold text-white mb-1">Motor em Execução</h3>
                                                <p className="text-gray-400 flex items-center gap-2 text-sm font-medium">
                                                    <Clock size={14} /> {status.current_action}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-3xl font-bold text-lime-400">
                                                {status.processed} <span className="text-gray-500 text-lg">/ {status.total}</span>
                                            </p>
                                            <p className="text-gray-400 text-sm font-medium">Contatos processados</p>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div className="bg-dark-900 p-6 rounded-xl border border-dark-700">
                                            <h4 className="text-gray-400 text-sm mb-4 uppercase tracking-wider font-bold flex items-center gap-2">
                                                <User size={16} /> Disparo Iniciado Por
                                            </h4>
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-lime-400 to-green-600 flex items-center justify-center text-dark-900 font-bold uppercase shadow-sm">
                                                    {(status.started_by || 'U').charAt(0)}
                                                </div>
                                                <p className="text-lg font-bold text-white">{status.started_by || "Desconhecido"}</p>
                                            </div>
                                        </div>

                                        <div className="bg-dark-900 p-6 rounded-xl border border-dark-700">
                                            <h4 className="text-gray-400 text-sm mb-4 uppercase tracking-wider font-bold flex items-center gap-2">
                                                <Phone size={16} /> Remetentes Utilizados
                                            </h4>
                                            <div className="flex flex-wrap gap-2">
                                                {status.sender_stats && Object.keys(status.sender_stats).length > 0 ? (
                                                    Object.values(status.sender_stats).map((sender, idx) => (
                                                        <span key={idx} className="bg-dark-800 border border-dark-700 px-4 py-2 rounded-full text-sm font-mono text-lime-400 flex items-center gap-2 shadow-sm font-bold">
                                                            {sender.name}
                                                        </span>
                                                    ))
                                                ) : (
                                                    <span className="text-gray-500 italic text-sm font-medium">Nenhum remetente com entrega efetuada ainda...</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    {index < statuses.length - 1 && <hr className="border-dark-700 my-8" />}
                                </motion.div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                        <div className="w-24 h-24 rounded-full bg-dark-900 border-2 border-dashed border-dark-700 flex items-center justify-center mb-6">
                            <Square className="text-gray-600" size={36} />
                        </div>
                        <h3 className="text-2xl font-bold text-gray-300 mb-2">Sistema Ocioso</h3>
                        <p className="text-gray-500 max-w-md font-medium">No momento, o disparador está parado nos bastidores. Nenhuma campanha ativa.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default LiveActivity;
