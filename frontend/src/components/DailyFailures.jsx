import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { AlertCircle, Download, Phone, User, Clock, Search, XCircle } from 'lucide-react';

const DailyFailures = ({ token }) => {
    const [failures, setFailures] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        fetchFailures();
    }, []);

    const fetchFailures = async () => {
        try {
            const res = await axios.get('/api/daily_failures');
            setFailures(res.data);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleDownload = async () => {
        try {
            const response = await axios.get('/api/download_failures', {
                responseType: 'blob',
            });
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `falhas_${new Date().toISOString().split('T')[0]}.xlsx`);
            document.body.appendChild(link);
            link.click();
            link.remove();
        } catch (err) {
            alert("Erro ao baixar planilha. Verifique se existem falhas hoje.");
        }
    };

    const filteredFailures = failures.filter(f =>
        (f.name && f.name.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (f.phone && f.phone.includes(searchTerm)) ||
        (f.details && f.details.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    if (loading) return <div className="p-8 text-lime-500">Carregando falhas do dia...</div>;

    return (
        <div className="p-8 space-y-8 pb-32 max-w-7xl mx-auto h-full overflow-y-auto">
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                        <XCircle size={32} className="text-red-500" />
                        Falhas do Dia
                    </h1>
                    <p className="text-gray-400 mt-2">Relatório detalhado de contatos que não receberam a mensagem hoje.</p>
                </div>
                <button
                    onClick={handleDownload}
                    disabled={failures.length === 0}
                    className="flex items-center gap-2 bg-lime-500 text-dark-900 px-6 py-3 rounded-xl font-bold hover:bg-lime-400 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-lime-500/20"
                >
                    <Download size={20} />
                    Baixar Planilha (Excel)
                </button>
            </header>

            <div className="bg-dark-800 rounded-2xl border border-dark-700 shadow-xl overflow-hidden">
                <div className="p-6 border-b border-dark-700 bg-dark-800/50 flex items-center gap-4">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
                        <input
                            type="text"
                            placeholder="Buscar por nome, número ou erro..."
                            className="w-full bg-dark-900 border border-dark-700 rounded-xl py-2 pl-10 pr-4 text-white focus:border-lime-500 focus:ring-1 focus:ring-lime-500 outline-none transition"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <div className="text-sm text-gray-400 font-medium">
                        Total: <span className="text-white">{failures.length}</span> falhas hoje
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-dark-900/50 text-gray-400 text-xs uppercase tracking-wider font-bold">
                            <tr>
                                <th className="px-6 py-4">Horário</th>
                                <th className="px-6 py-4">Nome</th>
                                <th className="px-6 py-4">Telefone</th>
                                <th className="px-6 py-4 text-red-400">Motivo da Falha</th>
                                <th className="px-6 py-4">Remetente</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-dark-700">
                            {filteredFailures.map((failure, idx) => (
                                <tr key={idx} className="hover:bg-dark-700/30 transition-colors group">
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-2 text-gray-400 font-mono text-xs">
                                            <Clock size={12} />
                                            {failure.timestamp ? new Date(failure.timestamp).toLocaleTimeString('pt-BR') : '--:--'}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-2">
                                            <div className="w-8 h-8 rounded-full bg-dark-700 flex items-center justify-center text-xs font-bold text-gray-400 group-hover:bg-lime-500 group-hover:text-dark-900 transition-colors">
                                                {(failure.name || 'C').charAt(0)}
                                            </div>
                                            <span className="font-bold text-white">{failure.name || 'Sem Nome'}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-2 text-gray-300 font-mono">
                                            <Phone size={14} className="text-gray-500" />
                                            {failure.phone}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium">
                                            <AlertCircle size={12} />
                                            {failure.details || 'Erro Indefinido'}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-gray-400 text-sm font-medium">
                                        {failure.sender_name || 'Desconhecido'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {filteredFailures.length === 0 && (
                    <div className="p-20 text-center">
                        {failures.length === 0 ? (
                            <>
                                <XCircle className="mx-auto text-gray-700 mb-4" size={48} />
                                <h3 className="text-lg font-bold text-gray-400">Nenhuma falha registrada hoje!</h3>
                                <p className="text-gray-600">Isso é ótimo, todos os envios foram processados com sucesso.</p>
                            </>
                        ) : (
                            <>
                                <Search className="mx-auto text-gray-700 mb-4" size={48} />
                                <h3 className="text-lg font-bold text-gray-400">Nenhum resultado para a busca.</h3>
                                <p className="text-gray-600">Tente ajustar seus termos de pesquisa.</p>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default DailyFailures;
