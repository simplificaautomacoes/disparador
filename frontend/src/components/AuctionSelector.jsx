import React, { useEffect, useState } from 'react';
import axios from 'axios';

export default function AuctionSelector({ value, onChange }) {
    const [profiles, setProfiles] = useState([]);
    const [adding, setAdding] = useState(false);
    const [name, setName] = useState('');
    const [id, setId] = useState('');
    const [error, setError] = useState('');
    useEffect(() => {
        axios.get('/api/leilao/profiles').then(({ data }) => setProfiles(data))
            .catch(() => setError('Não foi possível carregar os leilões.'));
    }, []);
    const create = async (event) => {
        event.preventDefault();
        setError('');
        try {
            const { data } = await axios.post('/api/leilao/profiles', { id, name });
            setProfiles(current => [...current, { id: data.id, name: data.name }]);
            onChange(data.id);
            setAdding(false);
            setName('');
            setId('');
        } catch (err) {
            setError(err.response?.data?.detail || 'Não foi possível criar o leilão.');
        }
    };
    return <section className="mx-4 md:mx-8 mt-6 p-4 bg-dark-800 border border-dark-700 rounded-xl space-y-3">
        <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="auction-selector" className="text-gray-300 font-bold">Leilão</label>
            <select id="auction-selector" value={value} onChange={event => onChange(event.target.value)}
                className="bg-dark-900 border border-dark-700 text-white p-3 rounded-lg">
                {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
            </select>
            <button onClick={() => setAdding(!adding)} className="text-lime-400 font-bold text-sm">{adding ? 'Cancelar' : '+ Novo leilão'}</button>
        </div>
        <p className="text-gray-400 text-sm">Cada leilão tem sua configuração, fila e histórico. Os números de envio são compartilhados.</p>
        {adding && <form onSubmit={create} className="flex flex-wrap gap-3">
            <input required value={name} onChange={event => setName(event.target.value)} placeholder="Nome do leilão"
                className="bg-dark-900 border border-dark-700 text-white p-3 rounded-lg" />
            <input required value={id} pattern="[a-z][a-z0-9_-]{0,49}" onChange={event => setId(event.target.value)} placeholder="Identificador na URL (ex.: parceiro)"
                className="bg-dark-900 border border-dark-700 text-white p-3 rounded-lg" />
            <button className="bg-lime-500 text-dark-900 rounded-lg px-4 font-bold">Criar leilão</button>
        </form>}
        {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}
    </section>;
}
