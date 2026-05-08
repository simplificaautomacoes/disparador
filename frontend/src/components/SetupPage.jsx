import React, { useState } from 'react';
import axios from 'axios';

export default function SetupPage({ onSetupComplete }) {
    const [formData, setFormData] = useState({ account_id: '', token_key: '', company_name: '', endpoint_url: 'https://seuservidor.com/api/v1' });
    const [logo, setLogo] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        try {
            const data = new FormData();
            data.append('account_id', formData.account_id);
            data.append('token_key', formData.token_key);
            data.append('company_name', formData.company_name);
            data.append('endpoint_url', formData.endpoint_url);
            if (logo) data.append('logo', logo);

            await axios.post('/api/setup', data, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            onSetupComplete();
        } catch (err) {
            setError(err.response?.data?.detail || "Erro ao salvar configurações. " + err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex h-screen items-center justify-center bg-dark-900 text-white font-sans pt-10 pb-10">
            <div className="w-full max-w-md bg-dark-800 p-8 rounded-xl border border-white/10 shadow-2xl">
                <div className="text-center mb-8">
                    <h1 className="text-3xl font-bold bg-gradient-to-r from-lime-400 to-emerald-400 bg-clip-text text-transparent">
                        Setup Inicial
                    </h1>
                    <p className="text-gray-400 mt-2 text-sm">
                        Bem-vindo! Configure as credenciais exclusivas do servidor de disparo para iniciar.
                    </p>
                </div>

                {error && (
                    <div className="bg-red-500/10 border border-red-500/50 text-red-500 p-3 rounded-lg mb-6 text-sm">
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-5">
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">Nome da Empresa</label>
                        <input
                            type="text"
                            required
                            className="w-full bg-dark-900 border border-white/10 rounded-lg p-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-lime-500/50 transition-all"
                            placeholder="Ex: Minha Empresa"
                            value={formData.company_name}
                            onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">Endpoint API (URL)</label>
                        <input
                            type="url"
                            required
                            className="w-full bg-dark-900 border border-white/10 rounded-lg p-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-lime-500/50 transition-all text-sm font-mono"
                            placeholder="https://seuservidor.com/api/v1"
                            value={formData.endpoint_url}
                            onChange={(e) => setFormData({ ...formData, endpoint_url: e.target.value })}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">Account ID</label>
                        <input
                            type="text"
                            required
                            className="w-full bg-dark-900 border border-white/10 rounded-lg p-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-lime-500/50 transition-all"
                            placeholder="Sua Account ID"
                            value={formData.account_id}
                            onChange={(e) => setFormData({ ...formData, account_id: e.target.value })}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">Token Key</label>
                        <input
                            type="password"
                            required
                            className="w-full bg-dark-900 border border-white/10 rounded-lg p-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-lime-500/50 transition-all"
                            placeholder="Seu Token (Key)"
                            value={formData.token_key}
                            onChange={(e) => setFormData({ ...formData, token_key: e.target.value })}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">Logo da Empresa (PNG)</label>
                        <input
                            type="file"
                            accept="image/png, image/jpeg"
                            required
                            className="w-full bg-dark-900 border border-white/10 rounded-lg p-2 text-white file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-lime-500/10 file:text-lime-500 cursor-pointer hover:file:bg-lime-500/20 transition-all"
                            onChange={(e) => setLogo(e.target.files[0])}
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-3 mt-4 bg-lime-500 hover:bg-lime-400 text-dark-900 font-bold rounded-lg transition-colors flex justify-center items-center shadow-lg hover:shadow-lime-500/20"
                    >
                        {loading ? 'Salvando...' : 'Finalizar Setup'}
                    </button>
                </form>
            </div>
        </div>
    );
}
