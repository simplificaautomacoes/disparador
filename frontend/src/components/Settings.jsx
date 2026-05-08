import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Save, Plus, Trash2 } from 'lucide-react';

const Settings = ({ token }) => {
    const [config, setConfig] = useState(null);
    const [loading, setLoading] = useState(true);

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

    const saveConfig = async () => {
        try {
            await axios.post('/api/config', config);
            alert("Configuração salva!");
        } catch (err) {
            alert("Erro ao salvar configuração");
        }
    };

    const toggleStatus = (id) => {
        setConfig(prev => {
            const newState = { ...prev };
            const newStatus = newState.id_numeros[id].status === "ativado" ? "desativado" : "ativado";
            newState.id_numeros[id].status = newStatus;
            return newState;
        });
    };

    const addDialog = (id) => {
        const dialogId = prompt("Digite o ID do diálogo:");
        if (!dialogId) return;
        setConfig(prev => {
            const newState = { ...prev };
            newState.id_numeros[id].dialogos.push(dialogId);
            return newState;
        });
    };

    const removeDialog = (senderId, dialogIndex) => {
        if (!confirm("Remover este diálogo?")) return;
        setConfig(prev => {
            const newState = { ...prev };
            newState.id_numeros[senderId].dialogos.splice(dialogIndex, 1);
            return newState;
        });
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
                    className="flex items-center gap-2 px-6 py-2 bg-lime-500 hover:bg-lime-600 text-dark-900 rounded-lg font-bold transition-colors"
                >
                    <Save size={18} /> Salvar Alterações
                </button>
            </header>

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
                            <div className="space-y-2">
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
                ))}
            </div>
        </div>
    );
};

export default Settings;
