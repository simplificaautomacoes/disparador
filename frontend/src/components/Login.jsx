import React, { useState } from 'react';
import axios from 'axios';
import { Lock, User, Eye, EyeOff } from 'lucide-react';

const Login = ({ onLogin }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        const formData = new FormData();
        formData.append('username', email);
        formData.append('password', password);

        try {
            const res = await axios.post('/api/token', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });

            const { access_token } = res.data;
            localStorage.setItem('token', access_token);

            // Get user role
            const userRes = await axios.get('/api/users/me', {
                headers: { Authorization: `Bearer ${access_token}` }
            });

            onLogin(userRes.data);
        } catch (err) {
            setError('Credenciais inválidas. Tente novamente.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-dark-900 p-4">
            <div className="bg-dark-800 p-8 rounded-2xl shadow-xl w-full max-w-md border border-dark-700">
                <div className="text-center mb-8">
                    <div className="w-16 h-16 bg-lime-500 rounded-full mx-auto flex items-center justify-center mb-4 text-dark-900">
                        <User size={32} />
                    </div>
                    <h2 className="text-2xl font-bold text-white">Bem-vindo</h2>
                    <p className="text-gray-400">Faça login para continuar</p>
                </div>

                {error && (
                    <div className="bg-red-500/10 border border-red-500 text-red-500 p-3 rounded-lg mb-6 text-sm text-center">
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-300">Email</label>
                        <div className="relative">
                            <input
                                type="text"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full bg-dark-900 border border-dark-700 rounded-lg py-3 px-4 text-white focus:outline-none focus:border-lime-500 transition-colors"
                                placeholder="usuario@email.com"
                                required
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-300">Senha</label>
                        <div className="relative">
                            <input
                                type={showPassword ? "text" : "password"}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full bg-dark-900 border border-dark-700 rounded-lg py-3 px-4 text-white focus:outline-none focus:border-lime-500 transition-colors pr-12"
                                placeholder="••••••"
                                required
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                            >
                                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-lime-500 hover:bg-lime-600 text-dark-900 font-bold py-3 rounded-lg transition-all shadow-lg shadow-lime-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {loading ? 'Carregando...' : 'Entrar'}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default Login;
