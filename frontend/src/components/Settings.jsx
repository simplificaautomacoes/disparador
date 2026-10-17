import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { Save, Plus, Trash2, Stethoscope, ChevronDown, ChevronUp, Play, RefreshCw, Info, CheckCircle } from 'lucide-react';

const QUALITY_BADGE = {
    verde: 'bg-green-500/20 text-green-400 border-green-500/30',
    amarelo: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    vermelho: 'bg-red-500/20 text-red-400 border-red-500/30',
    desconhecido: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
};

const DOT_COLOR = {
    ok: 'bg-green-500',
    aviso: 'bg-yellow-500',
    erro: 'bg-red-500',
};

const LIMIT_FIELDS = [
    { key: 'per_second', label: 'Por segundo', step: '0.1', hint: '0.5 = 1 msg a cada 2s' },
    { key: 'hourly', label: 'Por hora', step: '1' },
    { key: 'daily', label: 'Por dia', step: '1' },
    { key: 'meta_daily_cap', label: 'Teto Meta/dia', step: '1' },
    { key: 'auto_pause_failures', label: 'Pausar após N falhas', step: '1' },
];

const Settings = ({ token }) => {
    const [config, setConfig] = useState(null);
    const [loading, setLoading] = useState(true);

    // ── Limites e qualidade dos números ──
    const [showQuality, setShowQuality] = useState(false);
    const [diag, setDiag] = useState(null);
    const [diagLoading, setDiagLoading] = useState(false);
    const [quality, setQuality] = useState({});
    const [limits, setLimits] = useState({});
    const [qualityLoading, setQualityLoading] = useState(false);
    const [qualityMsg, setQualityMsg] = useState(null);
    const [savingLimits, setSavingLimits] = useState(false);

    useEffect(() => {
        fetchConfig();
    }, []);

    const fetchConfig = async () => {
        try {
            const res = await axios.get('/api/config');
            setConfig(res.data);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const [saving, setSaving] = useState(false);
    const [configMsg, setConfigMsg] = useState(null);

    const saveConfig = async () => {
        setSaving(true);
        setConfigMsg(null);
        try {
            // daily_limit fica de fora de proposito: quem manda no limite diario
            // e a tela "Limites e qualidade". Sem isso, salvar os dialogos
            // desviava o limite que a pessoa tinha acabado de ajustar.
            const payload = {
                id_numeros: Object.fromEntries(
                    Object.entries(config.id_numeros || {}).map(([id, n]) => [
                        id,
                        { status: n.status, dialogos: n.dialogos },
                    ])
                ),
            };
            await axios.post('/api/config', payload);

            // Confirma relendo do servidor: so mostra "salvou" se o valor
            // realmente estiver la.
            const confere = await axios.get('/api/config');
            setConfig(confere.data);
            setConfigMsg({ type: 'ok', text: 'Configuração salva!' });
        } catch (err) {
            const detalhe = err.response?.data?.detail || err.message;
            setConfigMsg({ type: 'erro', text: 'Erro ao salvar: ' + detalhe });
        } finally {
            setSaving(false);
        }
    };

    const toggleStatus = (id) => {
        setConfig(prev => ({
            ...prev,
            id_numeros: {
                ...prev.id_numeros,
                [id]: {
                    ...prev.id_numeros[id],
                    status: prev.id_numeros[id].status === "ativado" ? "desativado" : "ativado"
                }
            }
        }));
    };

    const addDialog = (id) => {
        const dialogId = prompt("Digite o ID do diálogo:");
        if (!dialogId) return;
        setConfig(prev => ({
            ...prev,
            id_numeros: {
                ...prev.id_numeros,
                [id]: {
                    ...prev.id_numeros[id],
                    dialogos: [...prev.id_numeros[id].dialogos, dialogId]
                }
            }
        }));
    };

    const removeDialog = (senderId, dialogIndex) => {
        if (!confirm("Remover este diálogo?")) return;
        setConfig(prev => ({
            ...prev,
            id_numeros: {
                ...prev.id_numeros,
                [senderId]: {
                    ...prev.id_numeros[senderId],
                    dialogos: prev.id_numeros[senderId].dialogos.filter((_, i) => i !== dialogIndex)
                }
            }
        }));
    };

    const addSender = async (id, ref) => {
        try {
            await axios.post('/api/senders', { id, ref_numero: ref });
            alert("Remetente adicionado!");
            fetchConfig(); // Reload to show new sender
        } catch (err) {
            alert("Erro ao adicionar remetente: " + (err.response?.data?.detail || err.message));
        }
    };

    const deleteSender = async (id) => {
        if (!confirm("Tem certeza que deseja excluir este remetente completamente?")) return;
        try {
            await axios.delete(`/api/senders/${encodeURIComponent(id)}`);
            fetchConfig();
        } catch (err) {
            console.error("Erro ao excluir remetente:", err);
            alert("Erro ao excluir remetente: " + (err.response?.data?.detail || err.message));
        }
    };

    const runDiagnostics = async () => {
        setDiagLoading(true);
        try {
            const res = await axios.get('/api/diagnostico');
            setDiag(res.data);
        } catch (err) {
            console.error(err);
            setQualityMsg({ type: 'erro', text: 'Não consegui rodar a verificação do sistema.' });
        } finally {
            setDiagLoading(false);
        }
    };

    const fetchQuality = useCallback(async () => {
        setQualityLoading(true);
        try {
            const res = await axios.get('/api/senders/quality');
            const senders = res.data?.senders || {};
            setQuality(senders);
            const next = {};
            Object.entries(senders).forEach(([id, info]) => {
                const l = info?.limits || {};
                next[id] = {
                    per_second: l.per_second_limit ?? 0,
                    hourly: l.hourly_limit ?? 0,
                    daily: l.daily_limit ?? 0,
                    meta_daily_cap: l.meta_daily_cap ?? 0,
                    auto_pause_failures: l.auto_pause_failures ?? 5,
                };
            });
            setLimits(next);
        } catch (err) {
            console.error(err);
        } finally {
            setQualityLoading(false);
        }
    }, []);

    const toggleQualitySection = () => {
        const next = !showQuality;
        setShowQuality(next);
        if (next) {
            fetchQuality();
            runDiagnostics();
        }
    };

    const setLimitField = (id, key, value) => {
        setLimits(prev => ({
            ...prev,
            [id]: { ...(prev[id] || {}), [key]: value }
        }));
    };

    const saveLimits = async () => {
        setQualityMsg(null);
        const payload = {};
        Object.entries(limits).forEach(([id, l]) => {
            const num = (v, fallback = 0) => {
                const parsed = parseFloat(v);
                return Number.isNaN(parsed) ? fallback : parsed;
            };
            payload[id] = {
                per_second: Math.max(0, num(l.per_second)),
                hourly: Math.max(0, Math.round(num(l.hourly))),
                daily: Math.max(0, Math.round(num(l.daily))),
                meta_daily_cap: Math.max(0, Math.round(num(l.meta_daily_cap))),
                auto_pause_failures: Math.max(0, Math.round(num(l.auto_pause_failures, 5))),
            };
        });
        setSavingLimits(true);
        try {
            await axios.post('/api/senders/limits', { limits: payload });
            // relê do servidor para a tela mostrar o que REALMENTE ficou
            await fetchQuality();
            runDiagnostics();
            setQualityMsg({ type: 'ok', text: 'Limites salvos!' });
        } catch (err) {
            const detalhe = err.response?.data?.detail || err.message;
            setQualityMsg({ type: 'erro', text: 'Erro ao salvar os limites: ' + detalhe });
        } finally {
            setSavingLimits(false);
        }
    };

    const unpauseSender = async (id) => {
        try {
            await axios.post('/api/senders/unpause', { sender_id: id });
            await fetchQuality();
            runDiagnostics();
        } catch (err) {
            console.error(err);
            setQualityMsg({ type: 'erro', text: 'Erro ao retomar o número.' });
        }
    };

    // só depois de TODOS os hooks (senão o React quebra com erro #310)
    if (loading) return <div>Carregando...</div>;

    return (
        <div className="p-8 space-y-8 pb-20">
            <header className="flex justify-between items-center">
                <div>
                    <h2 className="text-3xl font-bold text-white">Configurações</h2>
                    <p className="text-gray-400 mt-1">Gerencie remetentes e diálogos</p>
                </div>
                <button
                    onClick={saveConfig}
                    disabled={saving || !config}
                    className="flex items-center gap-2 px-6 py-2 bg-lime-500 hover:bg-lime-600 text-dark-900 rounded-lg font-bold transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                    <Save size={18} /> {saving ? 'Salvando...' : 'Salvar Alterações'}
                </button>
            </header>

            {configMsg && (
                <div
                    className={
                        'flex items-center gap-2 px-4 py-3 rounded-lg border text-sm ' +
                        (configMsg.type === 'ok'
                            ? 'border-green-500/30 bg-green-500/10 text-green-400'
                            : 'border-red-500/30 bg-red-500/10 text-red-400')
                    }
                >
                    {configMsg.text}
                </div>
            )}

            <div className="bg-dark-800 rounded-xl border border-dark-700 p-6">
                <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                    <Plus size={20} className="text-lime-500" /> Adicionar Novo Remetente
                </h3>
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        const id = e.target.senderId.value;
                        const ref = e.target.senderRef.value;
                        addSender(id, ref);
                        e.target.reset();
                    }}
                    className="flex flex-col md:flex-row gap-4"
                >
                    <input
                        name="senderId"
                        placeholder="ID do Remetente"
                        className="flex-1 bg-dark-900 border border-dark-700 text-white p-3 rounded-lg focus:outline-none focus:border-lime-500"
                        required
                    />
                    <input
                        name="senderRef"
                        placeholder="Referência (Ex: 3144)"
                        className="w-full md:w-48 bg-dark-900 border border-dark-700 text-white p-3 rounded-lg focus:outline-none focus:border-lime-500"
                        required
                    />
                    <button
                        type="submit"
                        className="bg-lime-500 hover:bg-lime-600 text-dark-900 px-6 py-3 rounded-lg font-bold transition-colors"
                    >
                        Adicionar
                    </button>
                </form>
            </div>

            <div className="grid gap-6">
                {config && Object.entries(config.id_numeros).map(([id, info]) => (
                    <div key={id} className={`bg-dark-800 rounded-xl border ${info.status === 'ativado' ? 'border-lime-500/50' : 'border-dark-700'} p-6 transition-all`}>
                        <div className="flex justify-between items-start mb-6">
                            <div>
                                <h3 className="text-xl font-bold text-white flex items-center gap-3">
                                    {info.ref_numero}
                                    <span className={`text-xs px-2 py-1 rounded-full ${info.status === 'ativado' ? 'bg-lime-500/20 text-lime-400' : 'bg-red-500/20 text-red-400'}`}>
                                        {info.status.toUpperCase()}
                                    </span>
                                </h3>
                                <p className="text-gray-500 font-mono text-sm mt-1">{id}</p>
                            </div>
                            <div className="flex items-center gap-4">
                                <button
                                    onClick={() => deleteSender(id)}
                                    className="text-red-500 hover:text-red-400 p-2 rounded-full hover:bg-dark-700 transition-colors"
                                    title="Excluir Remetente"
                                >
                                    <Trash2 size={20} />
                                </button>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input
                                        type="checkbox"
                                        className="sr-only peer"
                                        checked={info.status === 'ativado'}
                                        onChange={() => toggleStatus(id)}
                                    />
                                    <div className="w-11 h-6 bg-dark-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-lime-500"></div>
                                </label>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Limite Diário */}
                            <div className="bg-dark-900 rounded-lg p-4 flex flex-col justify-between">
                                <div>
                                    <h4 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-3">Limite de Disparos Diários</h4>
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="number"
                                            min="0"
                                            value={info.daily_limit !== undefined ? info.daily_limit : 0}
                                            onChange={(e) => {
                                                const val = parseInt(e.target.value) || 0;
                                                setConfig(prev => ({
                                                    ...prev,
                                                    id_numeros: {
                                                        ...prev.id_numeros,
                                                        [id]: {
                                                            ...prev.id_numeros[id],
                                                            daily_limit: val
                                                        }
                                                    }
                                                }));
                                            }}
                                            className="w-24 bg-dark-800 border border-dark-700 text-white p-2 rounded-lg focus:outline-none focus:border-lime-500 text-center font-bold"
                                            placeholder="0"
                                        />
                                        <span className="text-xs text-gray-400">
                                            (Defina 0 para ilimitado)
                                        </span>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-2">Os limites são redefinidos automaticamente à meia-noite (horário de Brasília).</p>
                                </div>
                                <div className="mt-4 pt-4 border-t border-dark-800 flex items-center justify-between">
                                    <span className="text-sm text-gray-400">Progresso de Hoje:</span>
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-bold text-white">
                                            {info.today_count || 0}
                                        </span>
                                        {info.daily_limit > 0 ? (
                                            <>
                                                <span className="text-gray-500 text-sm">/</span>
                                                <span className="text-sm font-bold text-lime-400">{info.daily_limit}</span>
                                                {info.today_count >= info.daily_limit && (
                                                    <span className="ml-2 px-2 py-0.5 text-[10px] bg-red-500/20 text-red-400 border border-red-500/30 rounded-full font-bold uppercase tracking-wider animate-pulse">
                                                        Limite Atingido
                                                    </span>
                                                )}
                                            </>
                                        ) : (
                                            <span className="text-[10px] text-gray-500 italic">(Sem Limite)</span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* IDs de Diálogo */}
                            <div className="bg-dark-900 rounded-lg p-4">
                                <div className="flex justify-between items-center mb-3">
                                    <h4 className="text-sm font-medium text-gray-400 uppercase tracking-wider">IDs de Diálogo</h4>
                                    <button
                                        onClick={() => addDialog(id)}
                                        className="text-xs flex items-center gap-1 text-lime-400 hover:text-lime-300"
                                    >
                                        <Plus size={14} /> Adicionar
                                    </button>
                                </div>
                                <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                                    {info.dialogos.map((dialog, idx) => (
                                        <div key={idx} className="flex justify-between items-center bg-dark-800 p-2 rounded border border-dark-700">
                                            <span className="font-mono text-sm text-gray-300">{dialog}</span>
                                            <button
                                                onClick={() => removeDialog(id, idx)}
                                                className="text-red-400 hover:text-red-300 p-1"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    ))}
                                    {info.dialogos.length === 0 && (
                                        <p className="text-gray-600 text-sm italic">Nenhum diálogo configurado</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* ── Limites e qualidade dos números ─────────────────────── */}
            <div className="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden">
                <button
                    onClick={toggleQualitySection}
                    className="w-full flex items-center justify-between p-6 hover:bg-dark-700/30 transition-colors"
                >
                    <h3 className="text-xl font-bold text-white flex items-center gap-2">
                        <Stethoscope size={20} className="text-lime-500" /> Limites e qualidade dos números
                    </h3>
                    {showQuality ? <ChevronUp size={20} className="text-gray-400" /> : <ChevronDown size={20} className="text-gray-400" />}
                </button>

                {showQuality && (
                    <div className="px-6 pb-6 space-y-6 border-t border-dark-700 pt-6">
                        {/* Diagnóstico */}
                        <div>
                            <div className="flex items-center justify-between gap-3 flex-wrap">
                                <h4 className="text-sm font-medium text-gray-400 uppercase tracking-wider">Verificação do sistema</h4>
                                <button
                                    onClick={runDiagnostics}
                                    disabled={diagLoading}
                                    className="flex items-center gap-2 px-4 py-2 bg-dark-900 hover:bg-dark-700 border border-dark-700 text-gray-300 hover:text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-60"
                                >
                                    <RefreshCw size={16} className={diagLoading ? 'animate-spin' : ''} />
                                    {diagLoading ? 'Verificando...' : 'Verificar sistema'}
                                </button>
                            </div>

                            {diag && (
                                <div className="mt-4 space-y-3">
                                    <div className={`flex items-center gap-2 px-4 py-3 rounded-lg border text-sm font-bold ${diag.pronto_para_disparar
                                        ? 'bg-green-500/10 border-green-500/30 text-green-400'
                                        : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
                                        {diag.pronto_para_disparar ? <CheckCircle size={18} /> : <Info size={18} />}
                                        {diag.pronto_para_disparar
                                            ? 'Tudo pronto para disparar'
                                            : 'Tem problema para resolver antes de disparar'}
                                    </div>

                                    <div className="flex flex-wrap gap-3 text-xs text-gray-400">
                                        <span className="flex items-center gap-1.5">
                                            <span className="w-2 h-2 rounded-full bg-green-500" /> {diag.resumo?.ok ?? 0} ok
                                        </span>
                                        <span className="flex items-center gap-1.5">
                                            <span className="w-2 h-2 rounded-full bg-yellow-500" /> {diag.resumo?.aviso ?? 0} aviso
                                        </span>
                                        <span className="flex items-center gap-1.5">
                                            <span className="w-2 h-2 rounded-full bg-red-500" /> {diag.resumo?.erro ?? 0} erro
                                        </span>
                                        {(diag.numeros_pausados?.length || 0) > 0 && (
                                            <span className="flex items-center gap-1.5 text-red-400">
                                                pausados: {diag.numeros_pausados.join(', ')}
                                            </span>
                                        )}
                                    </div>

                                    <div className="bg-dark-900 rounded-lg border border-dark-700 divide-y divide-dark-700">
                                        {(diag.checks || []).map((c, i) => (
                                            <div key={i} className="flex items-start gap-3 px-4 py-3">
                                                <span className={`w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0 ${DOT_COLOR[c.estado] || 'bg-gray-500'}`} />
                                                <div className="min-w-0">
                                                    <p className="text-white font-medium text-sm">{c.nome}</p>
                                                    <p className="text-gray-500 text-xs break-words">{c.detalhe}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Limites por número */}
                        <div>
                            <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                                <h4 className="text-sm font-medium text-gray-400 uppercase tracking-wider">Tetos por número</h4>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={fetchQuality}
                                        disabled={qualityLoading}
                                        className="flex items-center gap-2 px-4 py-2 bg-dark-900 hover:bg-dark-700 border border-dark-700 text-gray-300 hover:text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-60"
                                    >
                                        <RefreshCw size={16} className={qualityLoading ? 'animate-spin' : ''} />
                                        Atualizar
                                    </button>
                                    <button
                                        onClick={saveLimits}
                                        disabled={savingLimits || qualityLoading}
                                        className="flex items-center gap-2 px-5 py-2 bg-lime-500 hover:bg-lime-600 text-dark-900 rounded-lg font-bold transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                    >
                                        <Save size={16} /> {savingLimits ? 'Salvando...' : 'Salvar limites'}
                                    </button>
                                </div>
                            </div>

                            <div className="flex items-start gap-2 px-4 py-3 mb-4 rounded-lg border border-lime-500/20 bg-lime-500/10 text-lime-400 text-sm">
                                <Info size={16} className="mt-0.5 flex-shrink-0" />
                                <span>
                                    Teto é por NÚMERO. Ao bater, o contato passa para outro número. O que sobrar vira 'pulado', nunca falha.
                                </span>
                            </div>

                            {qualityMsg && (
                                <div className={`flex items-center gap-2 px-4 py-2.5 mb-4 rounded-lg border text-sm font-medium ${qualityMsg.type === 'erro'
                                    ? 'bg-red-500/10 border-red-500/30 text-red-400'
                                    : 'bg-lime-500/10 border-lime-500/30 text-lime-400'}`}>
                                    {qualityMsg.text}
                                </div>
                            )}

                            {Object.keys(quality).length === 0 ? (
                                <p className="text-gray-500 text-sm italic py-6 text-center">
                                    {qualityLoading ? 'Carregando...' : 'Nenhum número cadastrado.'}
                                </p>
                            ) : (
                                <div className="space-y-4">
                                    {Object.entries(quality).map(([id, info]) => {
                                        const q = info?.quality || {};
                                        const l = limits[id] || {};
                                        const isPaused = !!q.paused;
                                        const level = q.level || 'desconhecido';
                                        const hour = q.hour || {};
                                        const day = q.day || {};
                                        return (
                                            <div
                                                key={id}
                                                className={`bg-dark-900 rounded-lg border p-4 ${isPaused ? 'border-red-500/70' : 'border-dark-700'}`}
                                            >
                                                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                                                    <div className="flex items-center gap-3">
                                                        <h5 className="text-lg font-bold text-white">{info?.ref_numero || id}</h5>
                                                        <span className={`text-xs px-2.5 py-1 rounded-full font-bold border ${QUALITY_BADGE[level] || QUALITY_BADGE.desconhecido}`}>
                                                            {q.label || level}
                                                        </span>
                                                        {q.score !== null && q.score !== undefined && (
                                                            <span className="text-xs text-gray-500 font-mono">{q.score}/100</span>
                                                        )}
                                                    </div>
                                                    {isPaused && (
                                                        <button
                                                            onClick={() => unpauseSender(id)}
                                                            className="flex items-center gap-2 px-4 py-2 bg-lime-500 hover:bg-lime-600 text-dark-900 rounded-lg text-sm font-bold transition-colors"
                                                        >
                                                            <Play size={16} /> Retomar este número
                                                        </button>
                                                    )}
                                                </div>

                                                {isPaused && q.paused_reason && (
                                                    <p className="text-red-400 text-sm mb-3">
                                                        Pausado: {q.paused_reason}
                                                    </p>
                                                )}

                                                <div className="flex flex-wrap gap-3 mb-4">
                                                    {LIMIT_FIELDS.map((f) => (
                                                        <div key={f.key}>
                                                            <label className="block text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-1">
                                                                {f.label}
                                                            </label>
                                                            <input
                                                                type="number"
                                                                min="0"
                                                                step={f.step}
                                                                value={l[f.key] ?? 0}
                                                                onChange={(e) => setLimitField(id, f.key, e.target.value)}
                                                                className="w-full sm:w-28 bg-dark-800 border border-dark-700 text-white p-2 rounded-lg focus:outline-none focus:border-lime-500 text-center font-bold"
                                                            />
                                                        </div>
                                                    ))}
                                                </div>
                                                <p className="text-gray-500 text-xs -mt-2 mb-3">{LIMIT_FIELDS[0].hint}</p>

                                                <p className="text-gray-400 text-sm">
                                                    {hour.used ?? 0}/{hour.limit ?? 0} na hora, {day.used ?? 0}/{day.limit ?? 0} no dia
                                                </p>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Settings;
