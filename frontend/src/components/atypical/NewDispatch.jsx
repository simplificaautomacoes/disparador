import React, { useState } from 'react';
import axios from 'axios';
import { Upload as UploadIcon, FileSpreadsheet, Rocket, Clock, ArrowRight, X, Plus, Eye } from 'lucide-react';

const NewDispatch = () => {
    const [step, setStep] = useState(1); // 1=upload, 2=mapping, 3=note, 4=schedule
    const [uploading, setUploading] = useState(false);
    const [fileInfo, setFileInfo] = useState(null);
    const [columns, setColumns] = useState([]);
    const [sample, setSample] = useState([]);
    const [mapping, setMapping] = useState({ phone: '', phoneFallback: '', name: '' });
    const [noteTemplate, setNoteTemplate] = useState('📝 ANOTAÇÃO DE ATENDIMENTO\n\n');
    const [columnMapping, setColumnMapping] = useState({});
    const [scheduleMode, setScheduleMode] = useState('now');
    const [scheduleDate, setScheduleDate] = useState('');
    const [scheduleTime, setScheduleTime] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    const handleUpload = async (file) => {
        if (!file) return;
        setUploading(true);
        const formData = new FormData();
        formData.append('file', file);
        try {
            const res = await axios.post('/api/atypical/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
            setFileInfo({ path: res.data.file_path, name: res.data.filename, total: res.data.total_rows });
            setColumns(res.data.columns);
            setSample(res.data.sample || []);
            setStep(2);
        } catch (err) {
            alert('Erro: ' + (err.response?.data?.detail || err.message));
        } finally { setUploading(false); }
    };

    const addPlaceholder = (colName) => {
        const key = colName.toLowerCase().replace(/\s+/g, '_');
        if (!columnMapping[key]) {
            setColumnMapping(prev => ({ ...prev, [key]: { column: colName, format: 'text' } }));
        }
        setNoteTemplate(prev => prev + `{${key}}`);
    };

    const toggleFormat = (key) => {
        setColumnMapping(prev => ({
            ...prev,
            [key]: { ...prev[key], format: prev[key].format === 'text' ? 'money' : 'text' }
        }));
    };

    const removePlaceholder = (key) => {
        setColumnMapping(prev => { const n = { ...prev }; delete n[key]; return n; });
        setNoteTemplate(prev => prev.replaceAll(`{${key}}`, ''));
    };

    const getPreview = () => {
        if (sample.length === 0) return noteTemplate;
        let text = noteTemplate;
        for (const [key, m] of Object.entries(columnMapping)) {
            const val = sample[0]?.[m.column];
            let display = val == null ? '' : String(val);
            if (m.format === 'money') {
                try { display = `R$ ${parseFloat(display).toFixed(2).replace('.', ',')}`; } catch { }
            }
            text = text.replaceAll(`{${key}}`, display);
        }
        return text;
    };

    const handleSubmit = async () => {
        if (!fileInfo) return;
        setSubmitting(true);
        let scheduledAt = null;
        if (scheduleMode === 'schedule' && scheduleDate && scheduleTime) {
            scheduledAt = `${scheduleDate}T${scheduleTime}:00-03:00`;
        }
        try {
            await axios.post('/api/atypical/tasks', {
                file_path: fileInfo.path,
                phone_column: mapping.phone,
                phone_column_fallback: mapping.phoneFallback || null,
                name_column: mapping.name,
                note_template: noteTemplate,
                column_mapping: columnMapping,
                scheduled_at: scheduledAt,
                total: fileInfo.total
            });
            setSubmitted(true);
        } catch (err) {
            alert('Erro: ' + (err.response?.data?.detail || err.message));
        } finally { setSubmitting(false); }
    };

    const reset = () => {
        setStep(1); setFileInfo(null); setColumns([]); setSample([]);
        setMapping({ phone: '', phoneFallback: '', name: '' });
        setNoteTemplate('📝 ANOTAÇÃO DE ATENDIMENTO\n\n');
        setColumnMapping({}); setScheduleMode('now'); setSubmitted(false);
    };

    if (submitted) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="bg-lime-500/10 p-6 rounded-full mb-6"><Rocket size={48} className="text-lime-400" /></div>
                <h3 className="text-2xl font-bold text-white mb-2">
                    {scheduleMode === 'now' ? 'Disparo Iniciado!' : 'Disparo Agendado!'}
                </h3>
                <p className="text-gray-400 mb-6">
                    {scheduleMode === 'now' ? 'A tarefa está sendo executada. Acompanhe na aba Tarefas.' : `Agendado para ${scheduleDate} às ${scheduleTime}`}
                </p>
                <button onClick={reset} className="bg-lime-500 hover:bg-lime-600 text-dark-900 px-6 py-3 rounded-lg font-bold transition-colors">
                    Criar Novo Disparo
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Progress steps */}
            <div className="flex items-center justify-center gap-2 mb-6">
                {['Upload', 'Mapeamento', 'Anotação', 'Executar'].map((label, i) => (
                    <React.Fragment key={i}>
                        {i > 0 && <ArrowRight size={16} className="text-gray-600" />}
                        <div className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${step > i + 1 ? 'bg-lime-500/20 text-lime-400' : step === i + 1 ? 'bg-lime-500 text-dark-900' : 'bg-dark-700 text-gray-500'}`}>
                            {label}
                        </div>
                    </React.Fragment>
                ))}
            </div>

            {/* Step 1: Upload */}
            {step === 1 && (
                <div
                    className="w-full max-w-2xl mx-auto h-64 border-2 border-dashed border-dark-700 hover:border-lime-500 rounded-2xl bg-dark-800 flex flex-col items-center justify-center transition-colors cursor-pointer"
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => { e.preventDefault(); handleUpload(e.dataTransfer.files[0]); }}
                    onClick={() => document.getElementById('atypFileInput').click()}
                >
                    <input type="file" id="atypFileInput" className="hidden" accept=".xlsx" onChange={e => handleUpload(e.target.files[0])} />
                    {uploading ? (
                        <div className="flex flex-col items-center text-lime-400 animate-pulse">
                            <UploadIcon size={48} className="mb-3" />
                            <p>Enviando e analisando...</p>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center text-gray-500">
                            <UploadIcon size={48} className="mb-3 text-gray-600" />
                            <p className="text-lg">Arraste a planilha aqui</p>
                            <p className="text-sm mt-1">.xlsx</p>
                        </div>
                    )}
                </div>
            )}

            {/* Step 2: Column Mapping */}
            {step === 2 && (
                <div className="bg-dark-800 rounded-xl border border-dark-700 p-6 max-w-3xl mx-auto">
                    <h3 className="text-lg font-bold text-white mb-1">Mapeamento de Colunas</h3>
                    <p className="text-gray-400 text-sm mb-6">Arquivo: {fileInfo?.name} ({fileInfo?.total} linhas)</p>

                    <div className="space-y-4">
                        <div>
                            <label className="text-sm text-gray-400 mb-1 block">Coluna de Telefone *</label>
                            <select value={mapping.phone} onChange={e => setMapping(p => ({ ...p, phone: e.target.value }))}
                                className="w-full bg-dark-900 border border-dark-700 text-white p-3 rounded-lg focus:outline-none focus:border-lime-500">
                                <option value="">Selecione...</option>
                                {columns.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-sm text-gray-400 mb-1 block">Telefone Fallback (opcional)</label>
                            <select value={mapping.phoneFallback} onChange={e => setMapping(p => ({ ...p, phoneFallback: e.target.value }))}
                                className="w-full bg-dark-900 border border-dark-700 text-white p-3 rounded-lg focus:outline-none focus:border-lime-500">
                                <option value="">Nenhum</option>
                                {columns.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-sm text-gray-400 mb-1 block">Coluna de Nome *</label>
                            <select value={mapping.name} onChange={e => setMapping(p => ({ ...p, name: e.target.value }))}
                                className="w-full bg-dark-900 border border-dark-700 text-white p-3 rounded-lg focus:outline-none focus:border-lime-500">
                                <option value="">Selecione...</option>
                                {columns.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                    </div>
                    <div className="flex justify-end mt-6">
                        <button disabled={!mapping.phone || !mapping.name} onClick={() => setStep(3)}
                            className="bg-lime-500 hover:bg-lime-600 disabled:opacity-40 disabled:cursor-not-allowed text-dark-900 px-6 py-3 rounded-lg font-bold transition-colors flex items-center gap-2">
                            Próximo <ArrowRight size={18} />
                        </button>
                    </div>
                </div>
            )}

            {/* Step 3: Note Template */}
            {step === 3 && (
                <div className="max-w-4xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="bg-dark-800 rounded-xl border border-dark-700 p-6">
                        <h3 className="text-lg font-bold text-white mb-4">Editor de Anotação</h3>
                        <p className="text-gray-400 text-sm mb-3">Clique nas colunas abaixo para inserir como placeholder:</p>
                        <div className="flex flex-wrap gap-2 mb-4">
                            {columns.map(col => {
                                const key = col.toLowerCase().replace(/\s+/g, '_');
                                const isUsed = !!columnMapping[key];
                                return (
                                    <button key={col} onClick={() => addPlaceholder(col)}
                                        className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${isUsed ? 'bg-lime-500/20 border-lime-500/50 text-lime-400' : 'bg-dark-900 border-dark-700 text-gray-400 hover:border-lime-500 hover:text-white'}`}>
                                        {col}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Active placeholders */}
                        {Object.keys(columnMapping).length > 0 && (
                            <div className="mb-4 space-y-2">
                                <p className="text-xs text-gray-500 uppercase tracking-wider">Placeholders ativos:</p>
                                {Object.entries(columnMapping).map(([key, m]) => (
                                    <div key={key} className="flex items-center gap-2 bg-dark-900 p-2 rounded-lg border border-dark-700">
                                        <span className="text-lime-400 font-mono text-sm flex-1">{`{${key}}`}</span>
                                        <button onClick={() => toggleFormat(key)}
                                            className={`text-xs px-2 py-1 rounded ${m.format === 'money' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-dark-700 text-gray-400'}`}>
                                            {m.format === 'money' ? 'R$ Valor' : 'Texto'}
                                        </button>
                                        <button onClick={() => removePlaceholder(key)} className="text-red-400 hover:text-red-300 p-1">
                                            <X size={14} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        <textarea
                            value={noteTemplate}
                            onChange={e => setNoteTemplate(e.target.value)}
                            rows={10}
                            className="w-full bg-dark-900 border border-dark-700 text-white p-4 rounded-lg focus:outline-none focus:border-lime-500 font-mono text-sm resize-none"
                            placeholder="Monte o template da anotação..."
                        />
                    </div>

                    <div className="bg-dark-800 rounded-xl border border-dark-700 p-6">
                        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                            <Eye size={18} className="text-lime-500" /> Preview
                        </h3>
                        <div className="bg-dark-900 border border-dark-700 rounded-lg p-4 whitespace-pre-wrap text-sm text-gray-300 min-h-[200px] font-mono">
                            {getPreview()}
                        </div>
                        <p className="text-xs text-gray-500 mt-3">Preview com dados da primeira linha da planilha</p>
                    </div>

                    <div className="lg:col-span-2 flex justify-between">
                        <button onClick={() => setStep(2)} className="text-gray-400 hover:text-white px-4 py-2 transition-colors">← Voltar</button>
                        <button onClick={() => setStep(4)}
                            className="bg-lime-500 hover:bg-lime-600 text-dark-900 px-6 py-3 rounded-lg font-bold transition-colors flex items-center gap-2">
                            Próximo <ArrowRight size={18} />
                        </button>
                    </div>
                </div>
            )}

            {/* Step 4: Execute/Schedule */}
            {step === 4 && (
                <div className="bg-dark-800 rounded-xl border border-dark-700 p-8 max-w-xl mx-auto text-center">
                    <h3 className="text-xl font-bold text-white mb-2">Pronto para Disparar</h3>
                    <p className="text-gray-400 mb-6">{fileInfo?.total} contatos • {Object.keys(columnMapping).length} campos mapeados</p>

                    <div className="flex justify-center gap-4 mb-6">
                        <button onClick={() => setScheduleMode('now')}
                            className={`flex items-center gap-2 px-5 py-3 rounded-xl font-bold transition-all ${scheduleMode === 'now' ? 'bg-lime-500 text-dark-900 shadow-lg shadow-lime-500/20' : 'bg-dark-700 text-gray-400 hover:text-white'}`}>
                            <Rocket size={18} /> Agora
                        </button>
                        <button onClick={() => setScheduleMode('schedule')}
                            className={`flex items-center gap-2 px-5 py-3 rounded-xl font-bold transition-all ${scheduleMode === 'schedule' ? 'bg-lime-500 text-dark-900 shadow-lg shadow-lime-500/20' : 'bg-dark-700 text-gray-400 hover:text-white'}`}>
                            <Clock size={18} /> Agendar
                        </button>
                    </div>

                    {scheduleMode === 'schedule' && (
                        <div className="flex gap-3 justify-center mb-6">
                            <input type="date" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)}
                                className="bg-dark-900 border border-dark-700 text-white p-3 rounded-lg focus:outline-none focus:border-lime-500" />
                            <input type="time" value={scheduleTime} onChange={e => setScheduleTime(e.target.value)}
                                className="bg-dark-900 border border-dark-700 text-white p-3 rounded-lg focus:outline-none focus:border-lime-500" />
                            <span className="self-center text-gray-500 text-sm">(Horário de Brasília)</span>
                        </div>
                    )}

                    <div className="flex justify-between mt-4">
                        <button onClick={() => setStep(3)} className="text-gray-400 hover:text-white px-4 py-2 transition-colors">← Voltar</button>
                        <button onClick={handleSubmit} disabled={submitting || (scheduleMode === 'schedule' && (!scheduleDate || !scheduleTime))}
                            className="bg-lime-500 hover:bg-lime-600 disabled:opacity-40 disabled:cursor-not-allowed text-dark-900 px-8 py-3 rounded-lg font-bold transition-colors flex items-center gap-2">
                            {submitting ? 'Criando...' : scheduleMode === 'now' ? '🚀 Disparar Agora' : '⏰ Agendar Disparo'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default NewDispatch;
