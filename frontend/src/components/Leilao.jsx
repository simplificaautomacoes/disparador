import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import {
    Pause, Play, Copy, Check, Plus, Trash2, RefreshCw, Webhook,
    MessageSquare, ListChecks, StickyNote, Info, Clock
} from 'lucide-react';

const NOTE_VARS = [
    '{nome}', '{primeiro_nome}', '{cpf}', '{matricula}', '{valor_num}',
    '{prazo_desejado_parcelas}', '{origem}', '{tempo_vinculo_meses}',
    '{margem_disponivel}', '{celulares}', '{qualifica}', '{cnpj_empregador}',
    '{nome_empresa}', '{tipo_empregador}', '{cnaes_empregador}', '{lead_id}'
];

const STATUS_MAP = {
    sent: { bg: 'bg-green-500/20', text: 'text-green-400', label: 'Enviado' },
    queued: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', label: 'Na fila' },
    skipped: { bg: 'bg-gray-500/20', text: 'text-gray-400', label: 'Pulado' },
    failed: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'Falha' },
};

const formatDate = (iso) => {
    if (!iso) return '-';
    try {
        return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    } catch {
        return iso;
    }
};

const Leilao = () => {
    const [state, setState] = useState(null);
    const [senders, setSenders] = useState([]);
    const [log, setLog] = useState([]);
    const [loading, setLoading] = useState(true);

    // Campos editáveis
    const [intervalSeconds, setIntervalSeconds] = useState('1');
    const [noteTemplate, setNoteTemplate] = useState('');
    const noteRef = useRef(null);
    const noteCaret = useRef(null);

    // Diálogos
    const [dialogs, setDialogs] = useState([]);
    const [senderId, setSenderId] = useState('');
    const [dialogId, setDialogId] = useState('');
    const [dialogError, setDialogError] = useState('');
    const [dialogOk, setDialogOk] = useState('');

    // UI
    const [busy, setBusy] = useState(false);
    const [copied, setCopied] = useState(false);
    const [toast, setToast] = useState(null);

    const notify = useCallback((type, msg) => {
        setToast({ type, msg });
        setTimeout(() => setToast(null), 3500);
    }, []);

    const fetchState = useCallback(async () => {
        try {
            const res = await axios.get('/api/leilao/state');
            const d = res.data || {};
            setState(d);
            setIntervalSeconds(String(d.interval_seconds ?? 1));
            setNoteTemplate(d.note_template ?? '');
            // o backend devolve ld.id (id da linha em leilao_dialogs) junto de cada par
            setDialogs(Array.isArray(d.dialogs) ? d.dialogs : []);
        } catch (err) {
            console.error(err);
        }
    }, []);

    const fetchSenders = useCallback(async () => {
        try {
            const res = await axios.get('/api/config');
            const map = res.data?.id_numeros || {};
            setSenders(Object.entries(map).map(([id, info]) => ({
                id,
                ref_numero: info?.ref_numero || id,
                status: info?.status,
            })));
        } catch (err) {
            console.error(err);
        }
    }, []);

    const fetchLog = useCallback(async () => {
        try {
            const res = await axios.get('/api/leilao/log');
            setLog(Array.isArray(res.data) ? res.data : []);
        } catch (err) {
            console.error(err);
        }
    }, []);

    useEffect(() => {
        (async () => {
            await Promise.all([fetchState(), fetchSenders()]);
            setLoading(false);
        })();
    }, [fetchState, fetchSenders]);

    // Log: carrega uma vez e atualiza sozinho a cada 10s
    useEffect(() => {
        fetchLog();
        const interval = setInterval(fetchLog, 10000);
        return () => clearInterval(interval);
    }, [fetchLog]);

    const webhookFull = state?.webhook_url
        ? `${window.location.origin}${state.webhook_url}`
        : `${window.location.origin}/api/webhook/leilao`;

    const copyWebhook = async () => {
        try {
            await navigator.clipboard.writeText(webhookFull);
        } catch {
            const el = document.getElementById('leilao-webhook-url');
            if (el) { el.select(); document.execCommand('copy'); }
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const togglePause = async () => {
        if (!state) return;
        const next = !state.paused;
        setBusy(true);
        try {
            await axios.post('/api/leilao/state', { paused: next });
            if (!next) {
                // garante a drenagem da fila ao retomar
                try { await axios.post('/api/leilao/resume'); } catch { /* opcional */ }
            }
            await fetchState();
            notify('ok', next ? 'Disparo pausado.' : 'Retomado! Enviando a fila.');
        } catch (err) {
            console.error(err);
            notify('erro', 'Não consegui mudar o estado.');
        } finally {
            setBusy(false);
        }
    };

    const saveInterval = async () => {
        const value = parseFloat(intervalSeconds);
        if (Number.isNaN(value) || value < 0) {
            notify('erro', 'Informe um intervalo válido.');
            return;
        }
        setBusy(true);
        try {
            await axios.post('/api/leilao/state', { interval_seconds: value });
            await fetchState();
            notify('ok', `Intervalo salvo: ${value}s entre cada envio.`);
        } catch (err) {
            console.error(err);
            notify('erro', 'Erro ao salvar intervalo.');
        } finally {
            setBusy(false);
        }
    };

    const saveNote = async () => {
        setBusy(true);
        try {
            await axios.post('/api/leilao/state', { note_template: noteTemplate });
            await fetchState();
            notify('ok', 'Anotação automática salva.');
        } catch (err) {
            console.error(err);
            notify('erro', 'Erro ao salvar a anotação.');
        } finally {
            setBusy(false);
        }
    };

    const insertVar = (v) => {
        const value = noteTemplate || '';
        const pos = noteCaret.current ?? value.length;
        const next = value.slice(0, pos) + v + value.slice(pos);
        setNoteTemplate(next);
        noteCaret.current = pos + v.length;
    };

    const trackCaret = (el) => {
        if (!el) return;
        noteCaret.current = el.selectionStart ?? (noteTemplate || '').length;
    };

    const addDialog = async (e) => {
        e.preventDefault();
        setDialogError('');
        setDialogOk('');
        if (!senderId || !dialogId.trim()) {
            setDialogError('Escolha o número e informe o ID do diálogo.');
            return;
        }
        setBusy(true);
        try {
            await axios.post('/api/leilao/dialogs', { sender_id: senderId, dialog_id: dialogId.trim() });
            setDialogId('');
            setDialogOk('Par adicionado com sucesso.');
            await fetchState();
        } catch (err) {
            const status = err.response?.status;
            if (status === 400) {
                setDialogError('Já existe esse par (número, diálogo).');
            } else {
                setDialogError(err.response?.data?.detail || 'Erro ao adicionar o par.');
            }
        } finally {
            setBusy(false);
        }
    };

    const removeDialog = async (row) => {
        if (!confirm('Remover esse par (número, diálogo)?')) return;
        try {
            await axios.delete(`/api/leilao/dialogs/${row.id}`);
            await fetchState();
            notify('ok', 'Par removido.');
        } catch (err) {
            console.error(err);
            notify('erro', 'Erro ao remover o par.');
        }
    };

    if (loading) return <div className="text-gray-400 p-8">Carregando...</div>;

    const paused = !!state?.paused;

    return (
        <div className="p-4 md:p-8 space-y-6 pb-20">
            <header className="flex justify-between items-center">
                <div>
                    <h2 className="text-3xl font-bold text-white">Leilão</h2>
                    <p className="text-gray-400 mt-1">Receba leads do sistema de Leilão e envie na esteira, com limite por número</p>
                </div>
                <span className={`text-xs px-3 py-1.5 rounded-full font-bold ${paused ? 'bg-yellow-500/20 text-yellow-400' : 'bg-lime-500/20 text-lime-400'}`}>
                    {paused ? 'PAUSADO' : 'RODANDO'}
                </span>
            </header>

            {/* Toast */}
            {toast && (
                <div className={`flex items-center gap-2 px-4 py-3 rounded-lg border text-sm font-medium ${toast.type === 'erro'
                    ? 'bg-red-500/10 border-red-500/30 text-red-400'
                    : 'bg-lime-500/10 border-lime-500/30 text-lime-400'}`}>
                    {toast.type === 'erro' ? <Info size={16} /> : <Check size={16} />}
                    {toast.msg}
                </div>
            )}

            {/* ── 1. Estado e URL do webhook ─────────────────────────── */}
            <section className="bg-dark-800 rounded-xl border border-dark-700 p-6 space-y-6">
                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                    <Webhook size={20} className="text-lime-500" /> Estado e URL do webhook
                </h3>

                <div>
                    <label className="block text-sm font-medium text-gray-400 uppercase tracking-wider mb-2">
                        URL do webhook
                    </label>
                    <div className="flex flex-col sm:flex-row gap-2">
                        <input
                            id="leilao-webhook-url"
                            readOnly
                            value={webhookFull}
                            onFocus={trackCaret}
                            className="flex-1 font-mono text-sm bg-dark-900 border border-dark-700 text-lime-400 p-3 rounded-lg focus:outline-none focus:border-lime-500"
                        />
                        <button
                            onClick={copyWebhook}
                            className="flex items-center justify-center gap-2 px-5 py-3 bg-lime-500 hover:bg-lime-600 text-dark-900 rounded-lg font-bold transition-colors whitespace-nowrap"
                        >
                            {copied ? <Check size={18} /> : <Copy size={18} />}
                            {copied ? 'Copiado!' : 'Copiar'}
                        </button>
                    </div>
                    <p className="text-gray-500 text-sm mt-2">
                        Envie o lead do sistema de Leilão para esta URL. Não precisa de senha.
                    </p>
                </div>

                <button
                    onClick={togglePause}
                    disabled={busy}
                    className={`w-full sm:w-auto flex items-center justify-center gap-3 px-8 py-5 rounded-xl text-lg font-bold transition-colors disabled:opacity-60 ${paused
                        ? 'bg-lime-500 hover:bg-lime-600 text-dark-900 shadow-lg shadow-lime-500/20'
                        : 'bg-yellow-500 hover:bg-yellow-400 text-dark-900 shadow-lg shadow-yellow-500/20'}`}
                >
                    {paused ? <Play size={22} /> : <Pause size={22} />}
                    {paused ? 'Retomar e enviar a fila' : 'Pausar'}
                </button>

                <div className="grid gap-4 md:grid-cols-2">
                    <div className="bg-dark-900 rounded-lg p-4">
                        <label className="flex items-center gap-2 text-sm font-medium text-gray-400 uppercase tracking-wider mb-3">
                            <Clock size={14} /> Intervalo entre envios (segundos)
                        </label>
                        <div className="flex items-center gap-3">
                            <input
                                type="number"
                                min="0"
                                step="0.5"
                                value={intervalSeconds}
                                onChange={(e) => setIntervalSeconds(e.target.value)}
                                className="w-24 bg-dark-800 border border-dark-700 text-white p-2 rounded-lg focus:outline-none focus:border-lime-500 text-center font-bold"
                            />
                            <button
                                onClick={saveInterval}
                                disabled={busy}
                                className="bg-lime-500 hover:bg-lime-600 disabled:opacity-60 text-dark-900 px-4 py-2 rounded-lg font-bold transition-colors"
                            >
                                Salvar
                            </button>
                        </div>
                        <p className="text-gray-500 text-xs mt-2">1 segundo entre cada envio, para não queimar o número.</p>
                    </div>

                    <div className="bg-dark-900 rounded-lg p-4">
                        <label className="flex items-center gap-2 text-sm font-medium text-gray-400 uppercase tracking-wider mb-3">
                            <StickyNote size={14} /> Anotação automática (nota no atendimento)
                        </label>
                        <textarea
                            ref={noteRef}
                            rows={4}
                            value={noteTemplate}
                            onChange={(e) => { setNoteTemplate(e.target.value); trackCaret(e.target); }}
                            onClick={trackCaret}
                            onKeyUp={trackCaret}
                            onSelect={trackCaret}
                            placeholder="Ex.: Lead {nome}, CPF {cpf}, celular {celulares}, parcela {valor_num} em {prazo_desejado_parcelas}x"
                            className="w-full bg-dark-800 border border-dark-700 text-white p-3 rounded-lg focus:outline-none focus:border-lime-500 font-mono text-sm resize-y"
                        />
                        <div className="flex flex-wrap gap-1.5 mt-3">
                            {NOTE_VARS.map((v) => (
                                <button
                                    key={v}
                                    type="button"
                                    onClick={() => insertVar(v)}
                                    title={`Inserir ${v}`}
                                    className="font-mono text-[11px] px-2 py-1 rounded-md bg-dark-800 border border-dark-700 text-lime-400 hover:bg-lime-500 hover:text-dark-900 hover:border-lime-500 transition-colors"
                                >
                                    {v}
                                </button>
                            ))}
                        </div>
                        <div className="flex items-center justify-between gap-3 mt-3">
                            <p className="text-gray-500 text-xs">
                                Essa anotação aparece no ChatGuru para a pessoa do atendimento ver os dados do lead.
                            </p>
                            <button
                                onClick={saveNote}
                                disabled={busy}
                                className="flex-shrink-0 bg-lime-500 hover:bg-lime-600 disabled:opacity-60 text-dark-900 px-4 py-2 rounded-lg font-bold transition-colors"
                            >
                                Salvar
                            </button>
                        </div>
                    </div>
                </div>
            </section>

            {/* ── 2. Diálogos por número (round-robin) ───────────────── */}
            <section className="bg-dark-800 rounded-xl border border-dark-700 p-6 space-y-5">
                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                    <MessageSquare size={20} className="text-lime-500" /> Diálogos por número (rodízio)
                </h3>

                <form onSubmit={addDialog} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end">
                    <div>
                        <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
                            Número (remetente)
                        </label>
                        <select
                            value={senderId}
                            onChange={(e) => setSenderId(e.target.value)}
                            className="w-full bg-dark-900 border border-dark-700 text-white p-3 rounded-lg focus:outline-none focus:border-lime-500"
                        >
                            <option value="">Selecione...</option>
                            {senders.map((s) => (
                                <option key={s.id} value={s.id}>{s.ref_numero}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
                            Diálogo (ID do ChatGuru)
                        </label>
                        <input
                            value={dialogId}
                            onChange={(e) => setDialogId(e.target.value)}
                            placeholder="12345"
                            className="w-full bg-dark-900 border border-dark-700 text-white p-3 rounded-lg focus:outline-none focus:border-lime-500 font-mono"
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={busy}
                        className="flex items-center justify-center gap-2 bg-lime-500 hover:bg-lime-600 disabled:opacity-60 text-dark-900 px-6 py-3 rounded-lg font-bold transition-colors"
                    >
                        <Plus size={18} /> Adicionar par
                    </button>
                </form>

                {dialogError && (
                    <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border bg-red-500/10 border-red-500/30 text-red-400 text-sm font-medium">
                        <Info size={16} /> {dialogError}
                    </div>
                )}
                {dialogOk && (
                    <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border bg-lime-500/10 border-lime-500/30 text-lime-400 text-sm font-medium">
                        <Check size={16} /> {dialogOk}
                    </div>
                )}

                <p className="text-gray-500 text-sm">
                    Cada par (número + diálogo) entra no rodízio. Não tem limite de quantos diálogos você pode cadastrar por número.
                </p>

                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-dark-900/50 text-gray-400 text-xs uppercase tracking-wider font-bold">
                            <tr>
                                <th className="px-6 py-4">Número</th>
                                <th className="px-6 py-4">Diálogo</th>
                                <th className="px-6 py-4 text-right">Ação</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-dark-700">
                            {dialogs.length === 0 && (
                                <tr>
                                    <td colSpan={3} className="px-6 py-8 text-center text-gray-500 italic">
                                        Nenhum par cadastrado.
                                    </td>
                                </tr>
                            )}
                            {dialogs.map((d) => {
                                const refNumero = d.ref_numero
                                    || senders.find((s) => s.id === d.sender_id)?.ref_numero
                                    || d.sender_id;
                                return (
                                    <tr key={d.id} className="hover:bg-dark-700/30 transition-colors">
                                        <td className="px-6 py-4 text-white font-bold">{refNumero}</td>
                                        <td className="px-6 py-4 text-gray-300 font-mono text-sm">{d.dialog_id}</td>
                                        <td className="px-6 py-4 text-right">
                                            <button
                                                onClick={() => removeDialog(d)}
                                                title="Remover"
                                                className="text-red-500 hover:text-red-400 p-2 rounded-lg hover:bg-dark-700 transition-colors inline-flex"
                                            >
                                                <Trash2 size={18} />
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </section>

            {/* ── 3. Log de leads ────────────────────────────────────── */}
            <section className="bg-dark-800 rounded-xl border border-dark-700 p-6 space-y-4">
                <div className="flex justify-between items-center">
                    <h3 className="text-xl font-bold text-white flex items-center gap-2">
                        <ListChecks size={20} className="text-lime-500" /> Log de leads
                    </h3>
                    <button
                        onClick={fetchLog}
                        className="flex items-center gap-2 px-4 py-2 bg-dark-900 hover:bg-dark-700 border border-dark-700 text-gray-300 hover:text-white rounded-lg text-sm font-medium transition-colors"
                    >
                        <RefreshCw size={16} /> Atualizar
                    </button>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-dark-900/50 text-gray-400 text-xs uppercase tracking-wider font-bold">
                            <tr>
                                <th className="px-6 py-4">Data</th>
                                <th className="px-6 py-4">Telefone</th>
                                <th className="px-6 py-4">Nome</th>
                                <th className="px-6 py-4">Status</th>
                                <th className="px-6 py-4">Número</th>
                                <th className="px-6 py-4">Diálogo</th>
                                <th className="px-6 py-4">Detalhe</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-dark-700">
                            {log.length === 0 && (
                                <tr>
                                    <td colSpan={7} className="px-6 py-8 text-center text-gray-500 italic">
                                        Nenhum lead recebido ainda.
                                    </td>
                                </tr>
                            )}
                            {log.map((row) => {
                                const s = STATUS_MAP[row.status] || { bg: 'bg-gray-500/20', text: 'text-gray-400', label: row.status || '-' };
                                const refNumero = senders.find((x) => x.id === row.sender_id)?.ref_numero || row.sender_id;
                                return (
                                    <tr key={row.id} className="hover:bg-dark-700/30 transition-colors">
                                        <td className="px-6 py-4 text-gray-400 text-xs font-mono whitespace-nowrap">{formatDate(row.created_at)}</td>
                                        <td className="px-6 py-4 text-gray-300 font-mono text-sm">{row.phone || '-'}</td>
                                        <td className="px-6 py-4 text-white font-medium">{row.name || '-'}</td>
                                        <td className="px-6 py-4">
                                            <span className={`text-xs px-2.5 py-1 rounded-full font-bold whitespace-nowrap ${s.bg} ${s.text}`}>
                                                {s.label}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-gray-400 text-sm">{refNumero || '-'}</td>
                                        <td className="px-6 py-4 text-gray-400 font-mono text-xs">{row.dialog_id || '-'}</td>
                                        <td className="px-6 py-4 text-gray-500 text-sm max-w-xs truncate" title={row.details || ''}>
                                            {row.details || '-'}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    );
};

export default Leilao;