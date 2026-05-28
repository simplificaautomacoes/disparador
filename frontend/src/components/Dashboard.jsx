import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Play, Square, Pause, Activity, CheckCircle, XCircle, Clock, SkipForward } from 'lucide-react';
import { motion } from 'framer-motion';

const StatCard = ({ title, value, icon: Icon, color }) => (
    <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-dark-800 p-6 rounded-2xl border border-dark-700 relative overflow-hidden"
    >
        <div className={`absolute top-0 right-0 p-4 opacity-10 ${color}`}>
            <Icon size={64} />
        </div>
        <div className="flex items-center gap-4 mb-4">
            <div className={`p-3 rounded-lg ${color} bg-opacity-20 text-white`}>
                <Icon size={24} />
            </div>
            <h3 className="text-gray-400 font-medium">{title}</h3>
        </div>
        <p className="text-3xl font-bold text-white">{value}</p>
    </motion.div>
);

const Dashboard = ({ token }) => {
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [elapsed, setElapsed] = useState('');

    useEffect(() => {
        let timer;
        if (status?.start_time && status?.current_action && !status.current_action.includes("Concluído") && !status.current_action.includes("Parado")) {
            timer = setInterval(() => {
                const now = new Date();
                // status.start_time comes as a float (seconds since epoch) from python time.time()
                const start = typeof status.start_time === 'number' ? new Date(status.start_time * 1000) : new Date(status.start_time);

                // If the parsed start date is invalid or in the future due to clock sync issues, fallback gracefully
                if (isNaN(start.getTime()) || now < start) {
                    setElapsed("00:00");
                    return;
                }

                const diff = Math.floor((now - start) / 1000);
                const h = Math.floor(diff / 3600).toString().padStart(2, '0');
                const m = Math.floor((diff % 3600) / 60).toString().padStart(2, '0');
                const s = (diff % 60).toString().padStart(2, '0');
                setElapsed(h === "00" ? `${m}:${s}` : `${h}:${m}:${s}`);
            }, 1000);
        } else if (!status?.start_time) {
            setElapsed('');
        }
        return () => clearInterval(timer);
    }, [status?.start_time, status?.current_action]);

    const fetchStatus = async () => {
        try {
            const res = await axios.get('/api/status');
            setStatus(res.data);
        } catch (error) {
            console.error("Erro ao buscar status", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchStatus();
        const interval = setInterval(fetchStatus, 2000);
        return () => clearInterval(interval);
    }, []);

    const handleStop = async () => {
        try {
            await axios.post('/api/stop');
            fetchStatus();
        } catch (error) {
            alert("Erro ao pausar");
        }
    };

    const handleResume = async () => {
        try {
            await axios.post('/api/start', { sheet_name: status.current_sheet });
            fetchStatus();
        } catch (error) {
            alert("Erro ao retomar");
        }
    };

    if (loading && !status) return <div className="p-8 text-white">Carregando...</div>;

    return (
        <div className="p-4 md:p-8 space-y-6 md:space-y-8">
            <header className="flex flex-col md:flex-row md:justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-3xl font-bold text-white">Visão Geral</h2>
                    <p className="text-gray-400 mt-1">Estatísticas do disparador em tempo real</p>
                </div>
                <div className="flex gap-4">
                    {status?.current_action && status.current_action === "Parado pelo usuário" && (
                        <button
                            onClick={handleResume}
                            className="flex items-center gap-2 px-4 py-2 bg-lime-500 hover:bg-lime-600 text-dark-900 rounded-lg font-bold transition-colors"
                        >
                            <Play size={18} fill="currentColor" /> Retomar
                        </button>
                    )}
                    {status?.current_action && status?.current_action !== "Aguardando..." && status?.current_action !== "Idle" && status?.current_action !== "Pronto para iniciar" && status?.current_action !== "Parado pelo usuário" && status?.current_action !== "Concluído" && status?.current_action !== "Erro: Nenhum remetente ativo" && (
                        <button
                            onClick={handleStop}
                            className="flex items-center gap-2 px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-dark-900 rounded-lg font-bold transition-colors"
                        >
                            <Pause size={18} fill="currentColor" /> Pausar
                        </button>
                    )}
                </div>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
                <StatCard
                    title="Total Carregado"
                    value={status?.total || 0}
                    icon={Activity}
                    color="text-blue-500 bg-blue-500"
                />
                <StatCard
                    title="Processados"
                    value={`${status?.processed || 0}/${status?.total || 0}`}
                    icon={Clock}
                    color="text-yellow-500 bg-yellow-500"
                />
                <StatCard
                    title="Sucesso"
                    value={status?.success || 0}
                    icon={CheckCircle}
                    color="text-lime-500 bg-lime-500"
                />
                <StatCard
                    title="Falhas"
                    value={status?.failed || 0}
                    icon={XCircle}
                    color="text-red-500 bg-red-500"
                />
                <StatCard
                    title="Pulados"
                    value={status?.skipped || 0}
                    icon={SkipForward}
                    color="text-gray-500 bg-gray-500"
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 bg-dark-800 rounded-2xl border border-dark-700 p-6 flex flex-col">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-xl font-bold text-white flex items-center gap-2">
                            <Activity size={20} className="text-lime-500" />
                            Console de Atividades
                        </h3>
                        {elapsed && (
                            <div className="bg-dark-900 border border-lime-500/20 px-3 py-1 rounded-lg text-lime-400 font-mono text-sm flex items-center gap-2">
                                <Clock size={14} /> {elapsed}
                            </div>
                        )}
                    </div>

                    <div className="bg-dark-900 rounded-xl p-4 font-sans border border-dark-700 h-96 min-h-0 overflow-y-auto flex flex-col space-y-3 shadow-inner relative">
                        {status?.logs && status.logs.length > 0 ? (
                            status.logs.map((log, i) => {
                                const isString = typeof log === 'string';
                                const item = isString ? { mensagem: log, timestamp: '' } : log;
                                const isError = item.tipo?.toLowerCase().includes('falha') || item.mensagem?.toLowerCase().includes('erro');
                                const isWarning = item.tipo?.toLowerCase().includes('cadastrado') || item.mensagem?.toLowerCase().includes('aguardando');

                                return (
                                    <div key={i} className={`p-4 rounded-xl border transition-all ${i === 0 ? 'bg-dark-800 shadow-md border-lime-500/50' : 'bg-dark-800/40 border-dark-700 opacity-80 hover:opacity-100'}`}>
                                        <div className="flex justify-between items-start mb-2">
                                            <div className="flex items-center gap-2">
                                                {item.tipo && (
                                                    <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded w-max ${isError ? 'bg-red-500/20 text-red-400' : isWarning ? 'bg-yellow-500/20 text-yellow-400' : 'bg-lime-500/20 text-lime-400'}`}>
                                                        {item.tipo}
                                                    </span>
                                                )}
                                                <span className="text-xs text-gray-500 font-mono flex items-center gap-1">
                                                    <Clock size={12} /> {item.timestamp}
                                                </span>
                                            </div>
                                        </div>

                                        {item.numero && (
                                            <div className="mb-2 flex items-center justify-between border-b border-dark-700 pb-2">
                                                <p className="text-gray-200 font-medium truncate pr-2" title={item.nome}>{item.nome || 'Sem Nome'}</p>
                                                <p className="text-lime-400/80 font-mono text-sm shrink-0">{item.numero}</p>
                                            </div>
                                        )}

                                        <p className={`text-sm ${isError ? 'text-red-400' : isWarning ? 'text-yellow-200/90' : 'text-gray-300'}`}>
                                            {item.mensagem}
                                        </p>
                                    </div>
                                );
                            })
                        ) : (
                            <div className="text-gray-500 flex flex-col items-center justify-center h-full gap-2 opacity-50">
                                <Activity size={32} />
                                <span>Pronto para iniciar novo disparo.</span>
                            </div>
                        )}
                    </div>

                    {status?.total > 0 && (
                        <div className="mt-6">
                            <div className="flex justify-between text-sm text-gray-400 mb-2">
                                <span>Progresso</span>
                                <span>{Math.round((status.processed / status.total) * 100)}%</span>
                            </div>
                            <div className="w-full bg-dark-700 rounded-full h-2.5">
                                <div
                                    className="bg-lime-500 h-2.5 rounded-full transition-all duration-500"
                                    style={{ width: `${(status.processed / status.total) * 100}%` }}
                                ></div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="bg-dark-800 rounded-2xl border border-dark-700 p-6">
                    <h3 className="text-xl font-bold text-white mb-4">Estatísticas por Remetente</h3>
                    <div className="space-y-4">
                        {status?.sender_stats && Object.entries(status.sender_stats).map(([id, stats]) => (
                            <div key={id} className="p-3 bg-dark-700 rounded-lg space-y-2">
                                <div className="flex justify-between items-center">
                                    <div>
                                        <p className="text-sm font-medium text-white font-mono">{stats.name}</p>
                                        <p className="text-xs text-gray-400">ID: {id.slice(0, 8)}...</p>
                                    </div>
                                    <div className="bg-dark-900 px-3 py-1 rounded-md text-right">
                                        <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Total</p>
                                        <span className="text-lime-400 font-bold text-sm">{stats.sent_count}</span>
                                    </div>
                                </div>
                                <div className="pt-2 border-t border-dark-800 flex justify-between items-center text-xs text-gray-400">
                                    <span>Hoje:</span>
                                    <span className="font-semibold text-white">
                                        {stats.today_count || 0}
                                        {stats.daily_limit > 0 ? ` / ${stats.daily_limit}` : ' (Ilimitado)'}
                                    </span>
                                </div>
                                {stats.daily_limit > 0 && (
                                    <div className="w-full bg-dark-900 rounded-full h-1.5 mt-1 overflow-hidden">
                                        <div 
                                            className={`h-1.5 rounded-full transition-all duration-500 ${stats.today_count >= stats.daily_limit ? 'bg-red-500' : 'bg-lime-500'}`}
                                            style={{ width: `${Math.min(100, ((stats.today_count || 0) / stats.daily_limit) * 100)}%` }}
                                        ></div>
                                    </div>
                                )}
                            </div>
                        ))}
                        {(!status?.sender_stats || Object.keys(status.sender_stats).length === 0) && (
                            <p className="text-gray-500 text-center py-4">Sem dados</p>
                        )}
                    </div>
                </div>
            </div>

            {/* Nova seção de relatórios de falha */}
            <div className="bg-dark-800 rounded-2xl border border-dark-700 p-6 mt-6">
                <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                    <XCircle size={20} className="text-red-500" />
                    Relatório de Falhas Atuais ({status?.failed_contacts?.length || 0})
                </h3>
                <div className="bg-dark-900 rounded-xl border border-dark-700 max-h-64 overflow-y-auto">
                    <table className="w-full text-left text-sm text-gray-400">
                        <thead className="bg-dark-800 text-gray-300 sticky top-0 border-b border-dark-700">
                            <tr>
                                <th className="px-4 py-3 font-medium">Nome</th>
                                <th className="px-4 py-3 font-medium">Número</th>
                                <th className="px-4 py-3 font-medium">Motivo</th>
                            </tr>
                        </thead>
                        <tbody>
                            {status?.failed_contacts && status.failed_contacts.length > 0 ? (
                                status.failed_contacts.map((contact, idx) => (
                                    <tr key={idx} className="border-b border-dark-700 last:border-0 hover:bg-dark-800/50">
                                        <td className="px-4 py-3 text-white font-medium">{contact.nome || "---"}</td>
                                        <td className="px-4 py-3 font-mono">{contact.numero}</td>
                                        <td className="px-4 py-3 text-red-400">{contact.erro}</td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan="3" className="px-4 py-8 text-center text-gray-500">
                                        Nenhuma falha registrada nesta sessão.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
