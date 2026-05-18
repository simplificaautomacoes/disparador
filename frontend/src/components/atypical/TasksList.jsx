import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { CheckCircle, XCircle, Clock, Loader2, Trash2, Activity } from 'lucide-react';

const TasksList = () => {
    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchTasks();
        const interval = setInterval(fetchTasks, 2000);
        return () => clearInterval(interval);
    }, []);

    const fetchTasks = async () => {
        try {
            const res = await axios.get('/api/atypical/tasks');
            setTasks(res.data);
        } catch (err) { console.error(err); }
        finally { setLoading(false); }
    };

    const cancelTask = async (id) => {
        if (!confirm('Cancelar esta tarefa?')) return;
        await axios.delete(`/api/atypical/tasks/${id}`);
        fetchTasks();
    };

    const getStatusBadge = (status) => {
        const map = {
            pending: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'Iniciando...' },
            running: { bg: 'bg-lime-500/20', text: 'text-lime-400', label: 'Executando' },
            scheduled: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', label: 'Agendado' },
            done: { bg: 'bg-green-500/20', text: 'text-green-400', label: 'Concluído' },
            cancelled: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'Cancelado' },
            failed: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'Erro' },
        };
        const s = map[status] || map.failed;
        return <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${s.bg} ${s.text}`}>{s.label}</span>;
    };

    const getStatusIcon = (status) => {
        switch (status) {
            case 'running': return <Loader2 size={20} className="text-lime-400 animate-spin" />;
            case 'scheduled': return <Clock size={20} className="text-yellow-400" />;
            case 'done': return <CheckCircle size={20} className="text-green-400" />;
            case 'cancelled': case 'failed': return <XCircle size={20} className="text-red-400" />;
            default: return <Activity size={20} className="text-blue-400" />;
        }
    };

    const formatDate = (iso) => {
        if (!iso) return '-';
        try {
            const d = new Date(iso);
            return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        } catch { return iso; }
    };

    if (loading) return <div className="text-gray-400 p-8">Carregando...</div>;

    return (
        <div className="space-y-4">
            {tasks.length === 0 && (
                <div className="text-gray-500 text-center py-16 bg-dark-800 rounded-xl border border-dark-700">
                    <Activity size={48} className="mx-auto mb-3 opacity-30" />
                    <p>Nenhuma tarefa atípica ainda</p>
                    <p className="text-sm mt-1">Crie um disparo na aba "Novo Disparo"</p>
                </div>
            )}

            {tasks.map(task => {
                const pct = task.total > 0 ? Math.round((task.processed / task.total) * 100) : 0;
                const isActive = task.status === 'running' || task.status === 'pending';
                const isScheduled = task.status === 'scheduled';

                return (
                    <div key={task.id} className={`bg-dark-800 rounded-xl border p-5 transition-all ${isActive ? 'border-lime-500/50' : 'border-dark-700'}`}>
                        <div className="flex justify-between items-start mb-3">
                            <div className="flex items-center gap-3">
                                {getStatusIcon(task.status)}
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-white font-bold">Tarefa #{task.id}</span>
                                        {getStatusBadge(task.status)}
                                    </div>
                                    <p className="text-gray-500 text-sm mt-0.5">
                                        Criado: {formatDate(task.created_at)}
                                        {task.created_by && ` por ${task.created_by}`}
                                    </p>
                                </div>
                            </div>
                            {(isActive || isScheduled) && (
                                <button onClick={() => cancelTask(task.id)} className="text-red-500 hover:text-red-400 p-2 rounded-lg hover:bg-dark-700 transition-colors" title="Cancelar">
                                    <Trash2 size={18} />
                                </button>
                            )}
                        </div>

                        {/* Stats */}
                        <div className="grid grid-cols-5 gap-3 mb-3">
                            {[
                                { label: 'Total', val: task.total, color: 'text-white' },
                                { label: 'Processados', val: task.processed, color: 'text-blue-400' },
                                { label: 'Sucesso', val: task.success, color: 'text-lime-400' },
                                { label: 'Falhas', val: task.failed, color: 'text-red-400' },
                                { label: 'Ignorados', val: task.skipped, color: 'text-gray-400' },
                            ].map(s => (
                                <div key={s.label} className="bg-dark-900 rounded-lg p-2 text-center">
                                    <p className="text-[10px] text-gray-500 uppercase">{s.label}</p>
                                    <p className={`text-lg font-bold ${s.color}`}>{s.val}</p>
                                </div>
                            ))}
                        </div>

                        {/* Progress bar */}
                        {(isActive || task.status === 'done') && task.total > 0 && (
                            <div className="mb-3">
                                <div className="flex justify-between text-xs text-gray-500 mb-1">
                                    <span>Progresso</span>
                                    <span>{pct}%</span>
                                </div>
                                <div className="w-full bg-dark-700 rounded-full h-2">
                                    <div className={`h-2 rounded-full transition-all duration-500 ${task.status === 'done' ? 'bg-green-500' : 'bg-lime-500'}`}
                                        style={{ width: `${pct}%` }} />
                                </div>
                            </div>
                        )}

                        {/* Schedule info */}
                        {isScheduled && (
                            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 flex items-center gap-2">
                                <Clock size={16} className="text-yellow-400" />
                                <span className="text-yellow-400 text-sm">Agendado para: {formatDate(task.scheduled_at)}</span>
                            </div>
                        )}

                        {/* Logs */}
                        {task.logs && task.logs.length > 0 && (
                            <div className="mt-3 bg-dark-900 rounded-lg border border-dark-700 max-h-32 overflow-y-auto">
                                {task.logs.slice(0, 5).map((log, i) => (
                                    <div key={i} className={`px-3 py-1.5 text-xs border-b border-dark-700 last:border-0 flex justify-between ${log.tipo === 'falha' ? 'text-red-400' : log.tipo === 'cadastrado' ? 'text-yellow-300' : 'text-gray-400'}`}>
                                        <span className="truncate flex-1">{log.mensagem}</span>
                                        <span className="text-gray-600 ml-2 shrink-0">{log.timestamp}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

export default TasksList;
