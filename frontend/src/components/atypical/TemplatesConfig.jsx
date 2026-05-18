import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Save, Plus, Trash2, Tag } from 'lucide-react';

const TemplatesConfig = () => {
    const [templates, setTemplates] = useState([]);
    const [senders, setSenders] = useState({});
    const [loading, setLoading] = useState(true);
    const [newTemplate, setNewTemplate] = useState({ sender_id: '', dialog_id: '', label: '' });

    useEffect(() => { fetchData(); }, []);

    const fetchData = async () => {
        try {
            const [tplRes, sndRes] = await Promise.all([
                axios.get('/api/atypical/templates'),
                axios.get('/api/atypical/senders')
            ]);
            setTemplates(tplRes.data);
            setSenders(sndRes.data.id_numeros || {});
        } catch (err) { console.error(err); }
        finally { setLoading(false); }
    };

    const addTemplate = async () => {
        if (!newTemplate.sender_id || !newTemplate.dialog_id) return alert('Preencha ID do remetente e diálogo');
        try {
            await axios.post('/api/atypical/templates', newTemplate);
            setNewTemplate({ sender_id: '', dialog_id: '', label: '' });
            fetchData();
        } catch (err) { alert('Erro: ' + (err.response?.data?.detail || err.message)); }
    };

    const toggleStatus = async (tpl) => {
        const newStatus = tpl.status === 'ativado' ? 'desativado' : 'ativado';
        await axios.put(`/api/atypical/templates/${tpl.id}`, { status: newStatus });
        fetchData();
    };

    const deleteTemplate = async (id) => {
        if (!confirm('Remover este template?')) return;
        await axios.delete(`/api/atypical/templates/${id}`);
        fetchData();
    };

    if (loading) return <div className="text-gray-400 p-8">Carregando...</div>;

    const senderOptions = Object.entries(senders);

    return (
        <div className="space-y-6">
            {/* Adicionar template */}
            <div className="bg-dark-800 rounded-xl border border-dark-700 p-6">
                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                    <Plus size={20} className="text-lime-500" /> Novo Template Atípico
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <select
                        value={newTemplate.sender_id}
                        onChange={e => setNewTemplate(p => ({ ...p, sender_id: e.target.value }))}
                        className="bg-dark-900 border border-dark-700 text-white p-3 rounded-lg focus:outline-none focus:border-lime-500"
                    >
                        <option value="">Selecione o remetente</option>
                        {senderOptions.map(([id, info]) => (
                            <option key={id} value={id}>{info.ref_numero} ({id.slice(0, 8)}...)</option>
                        ))}
                    </select>
                    <input
                        placeholder="ID do Diálogo"
                        value={newTemplate.dialog_id}
                        onChange={e => setNewTemplate(p => ({ ...p, dialog_id: e.target.value }))}
                        className="bg-dark-900 border border-dark-700 text-white p-3 rounded-lg focus:outline-none focus:border-lime-500"
                    />
                    <input
                        placeholder="Label (ex: Handmais)"
                        value={newTemplate.label}
                        onChange={e => setNewTemplate(p => ({ ...p, label: e.target.value }))}
                        className="bg-dark-900 border border-dark-700 text-white p-3 rounded-lg focus:outline-none focus:border-lime-500"
                    />
                    <button onClick={addTemplate} className="bg-lime-500 hover:bg-lime-600 text-dark-900 px-6 py-3 rounded-lg font-bold transition-colors">
                        Adicionar
                    </button>
                </div>
            </div>

            {/* Lista de templates */}
            <div className="grid gap-4">
                {templates.length === 0 && (
                    <div className="text-gray-500 text-center py-12 bg-dark-800 rounded-xl border border-dark-700">
                        <Tag size={48} className="mx-auto mb-3 opacity-30" />
                        <p>Nenhum template atípico configurado</p>
                        <p className="text-sm mt-1">Adicione templates acima para começar</p>
                    </div>
                )}
                {templates.map(tpl => (
                    <div key={tpl.id} className={`bg-dark-800 rounded-xl border p-5 transition-all ${tpl.status === 'ativado' ? 'border-lime-500/50' : 'border-dark-700 opacity-60'}`}>
                        <div className="flex justify-between items-center">
                            <div>
                                <h4 className="text-white font-bold flex items-center gap-2">
                                    {tpl.label || 'Sem Label'}
                                    <span className={`text-xs px-2 py-0.5 rounded-full ${tpl.status === 'ativado' ? 'bg-lime-500/20 text-lime-400' : 'bg-red-500/20 text-red-400'}`}>
                                        {tpl.status?.toUpperCase()}
                                    </span>
                                </h4>
                                <p className="text-gray-500 text-sm font-mono mt-1">
                                    Remetente: {tpl.ref_numero || tpl.sender_id.slice(0, 12) + '...'} | Diálogo: {tpl.dialog_id}
                                </p>
                            </div>
                            <div className="flex items-center gap-3">
                                <button onClick={() => deleteTemplate(tpl.id)} className="text-red-500 hover:text-red-400 p-2 rounded-full hover:bg-dark-700 transition-colors">
                                    <Trash2 size={18} />
                                </button>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input type="checkbox" className="sr-only peer" checked={tpl.status === 'ativado'} onChange={() => toggleStatus(tpl)} />
                                    <div className="w-11 h-6 bg-dark-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-lime-500"></div>
                                </label>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default TemplatesConfig;
