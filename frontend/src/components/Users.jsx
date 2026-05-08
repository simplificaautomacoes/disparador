import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Plus, Trash2, Key, Save } from 'lucide-react';

const UserManagement = ({ token }) => {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showAddModal, setShowAddModal] = useState(false);
    const [newUser, setNewUser] = useState({ email: '', password: '', role: 'user' });
    const [changePasswordUser, setChangePasswordUser] = useState(null);
    const [newPassword, setNewPassword] = useState('');

    const api = axios.create({
        baseURL: '/api',
        headers: { Authorization: `Bearer ${token}` }
    });

    useEffect(() => {
        fetchUsers();
    }, []);

    const fetchUsers = async () => {
        try {
            const res = await api.get('/users');
            setUsers(res.data);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleCreateUser = async (e) => {
        e.preventDefault();
        try {
            await api.post('/users', newUser);
            setShowAddModal(false);
            setNewUser({ email: '', password: '', role: 'user' });
            fetchUsers();
        } catch (err) {
            alert("Erro ao criar usuário: " + err.response?.data?.detail || err.message);
        }
    };

    const handleChangePassword = async (e) => {
        e.preventDefault();
        try {
            await api.put(`/users/${changePasswordUser}/password`, { new_password: newPassword });
            setChangePasswordUser(null);
            setNewPassword('');
            alert("Senha alterada com sucesso!");
        } catch (err) {
            alert("Erro ao alterar senha");
        }
    };

    return (
        <div className="p-8 pb-32">
            <header className="flex justify-between items-center mb-8">
                <div>
                    <h2 className="text-3xl font-bold text-white">Usuários</h2>
                    <p className="text-gray-400 mt-1">Gerencie acesso ao sistema</p>
                </div>
                <button
                    onClick={() => setShowAddModal(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-lime-500 hover:bg-lime-600 text-dark-900 rounded-lg font-bold"
                >
                    <Plus size={18} /> Novo Usuário
                </button>
            </header>

            <div className="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden">
                <table className="w-full text-left">
                    <thead className="bg-dark-900 text-gray-400 text-sm">
                        <tr>
                            <th className="p-4">Email</th>
                            <th className="p-4">Permissão</th>
                            <th className="p-4 text-right">Ações</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-dark-700">
                        {users.map(user => (
                            <tr key={user.email}>
                                <td className="p-4 font-medium text-white">{user.email}</td>
                                <td className="p-4">
                                    <span className={`px-2 py-1 rounded text-xs ${user.role === 'admin' ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-400'}`}>
                                        {user.role}
                                    </span>
                                </td>
                                <td className="p-4 text-right">
                                    <button
                                        onClick={() => setChangePasswordUser(user.email)}
                                        className="text-gray-400 hover:text-white p-2"
                                        title="Alterar Senha"
                                    >
                                        <Key size={18} />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Basic Modals (Keeping inline for simplicity) */}
            {showAddModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div className="bg-dark-800 p-6 rounded-xl w-full max-w-md border border-dark-600">
                        <h3 className="text-xl font-bold text-white mb-4">Adicionar Usuário</h3>
                        <form onSubmit={handleCreateUser} className="space-y-4">
                            <input
                                className="w-full bg-dark-900 border border-dark-700 rounded p-2 text-white"
                                placeholder="Email"
                                value={newUser.email}
                                onChange={e => setNewUser({ ...newUser, email: e.target.value })}
                                required
                            />
                            <input
                                className="w-full bg-dark-900 border border-dark-700 rounded p-2 text-white"
                                placeholder="Senha"
                                type="password"
                                value={newUser.password}
                                onChange={e => setNewUser({ ...newUser, password: e.target.value })}
                                required
                            />
                            <select
                                className="w-full bg-dark-900 border border-dark-700 rounded p-2 text-white"
                                value={newUser.role}
                                onChange={e => setNewUser({ ...newUser, role: e.target.value })}
                            >
                                <option value="user">Usuário Comum</option>
                                <option value="admin">Administrador</option>
                            </select>
                            <div className="flex justify-end gap-2 mt-4">
                                <button type="button" onClick={() => setShowAddModal(false)} className="px-4 py-2 text-gray-400 hover:text-white">Cancelar</button>
                                <button type="submit" className="px-4 py-2 bg-lime-500 text-dark-900 rounded font-bold">Salvar</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {changePasswordUser && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div className="bg-dark-800 p-6 rounded-xl w-full max-w-md border border-dark-600">
                        <h3 className="text-xl font-bold text-white mb-4">Trocar Senha: {changePasswordUser}</h3>
                        <form onSubmit={handleChangePassword} className="space-y-4">
                            <input
                                className="w-full bg-dark-900 border border-dark-700 rounded p-2 text-white"
                                placeholder="Nova Senha"
                                type="password"
                                value={newPassword}
                                onChange={e => setNewPassword(e.target.value)}
                                required
                            />
                            <div className="flex justify-end gap-2 mt-4">
                                <button type="button" onClick={() => setChangePasswordUser(null)} className="px-4 py-2 text-gray-400 hover:text-white">Cancelar</button>
                                <button type="submit" className="px-4 py-2 bg-lime-500 text-dark-900 rounded font-bold">Salvar</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

        </div>
    );
};

export default UserManagement;
