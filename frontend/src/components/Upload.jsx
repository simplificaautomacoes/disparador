import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
    Upload as UploadIcon, FileSpreadsheet, Play, RotateCcw, StickyNote,
    ChevronDown, ChevronUp, Eye, Clock, Save, FlaskConical, Info, Check,
    X, Plus, Type as TypeIcon, DollarSign, Table2
} from 'lucide-react';

/* ── Helpers ─────────────────────────────────────────────────────────────── */

// Regra do ChatGuru: DDD de 11 a 29 usa o 9º dígito (13 dígitos), o resto usa 12.
const DDD_NOVE_DIGITO = {
    11: 'São Paulo', 12: 'São José dos Campos', 13: 'Santos', 14: 'Bauru',
    15: 'Sorocaba', 16: 'Ribeirão Preto', 17: 'São José do Rio Preto',
    18: 'Presidente Prudente', 19: 'Campinas', 21: 'Rio de Janeiro',
    22: 'Campos dos Goytacazes', 24: 'Volta Redonda', 27: 'Vitória',
    28: 'Cachoeiro de Itapemirim',
};

const EMPTY_FORM = { noteTemplate: '', columnMapping: {}, intervalSeconds: 1, manualColumns: [] };

const onlyDigits = (value) => String(value ?? '').replace(/\D/g, '');

const normalizeKey = (name) =>
    String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'campo';

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Aceita "1500,50", "1500.50", "1.500,50", "1500" e "R$ 1.500,50".
const parseNumberBR = (value) => {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    let s = String(value).trim().replace(/r\$/gi, '').replace(/\s/g, '');
    if (!s) return null;
    if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/[.,]/g, '');
    s = s.replace(/[^\d.-]/g, '');
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
};

const formatMoneyBR = (value) => {
    const n = parseNumberBR(value);
    if (n === null) return value === null || value === undefined ? '' : String(value);
    return 'R$ ' + n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

const formatValue = (value, format) => {
    if (value === null || value === undefined) return '';
    return format === 'money' ? formatMoneyBR(value) : String(value);
};

const PLACEHOLDER_RE = /\{([a-zA-Z0-9_]+)\}/g;

const usedPlaceholders = (tpl) => {
    const found = [];
    const re = new RegExp(PLACEHOLDER_RE.source, 'g');
    let match;
    while ((match = re.exec(tpl || '')) !== null) {
        if (!found.includes(match[1])) found.push(match[1]);
    }
    return found;
};

// Renderiza o template no cliente (nenhuma chamada ao backend por tecla).
const renderTemplate = (tpl, row, columnMapping) => {
    let out = tpl || '';
    usedPlaceholders(out).forEach((key) => {
        const m = (columnMapping || {})[key] || { column: key, format: 'text' };
        const raw = row ? row[m.column] : undefined;
        out = out.replace(new RegExp(`\\{${escapeRegExp(key)}\\}`, 'g'), formatValue(raw, m.format));
    });
    return out;
};

// DDD = dígitos 3 e 4 do número já normalizado de 12 dígitos.
const phoneDecision = (numero) => {
    const digits = onlyDigits(numero);
    const ddd = Number(digits.slice(2, 4));
    const valid = Number.isFinite(ddd) && ddd > 0;
    const usesNine = valid && ddd >= 11 && ddd <= 29;
    const dddLabel = valid ? String(ddd).padStart(2, '0') : '??';
    const region = DDD_NOVE_DIGITO[ddd];
    return {
        ddd,
        valid,
        usesNine,
        reason: usesNine
            ? `DDD ${dddLabel}${region ? `: região de ${region}` : ''} usa 9 dígitos`
            : `DDD ${dddLabel} usa 8 dígitos`,
    };
};

// O backend pode mandar sheets_info como lista (contrato) ou como mapa por aba.
const normalizeSheetsInfo = (raw, sheetNames) => {
    let list = [];
    if (Array.isArray(raw)) list = raw;
    else if (raw && typeof raw === 'object') list = Object.entries(raw).map(([name, info]) => ({ name, ...(info || {}) }));

    const byName = new Map();
    list.forEach((item) => { if (item && item.name) byName.set(item.name, item); });

    const names = sheetNames && sheetNames.length ? sheetNames : list.map((i) => i.name);
    return names.map((name) => {
        const info = byName.get(name) || {};
        return {
            name,
            columns: Array.isArray(info.columns) ? info.columns : [],
            total: info.total ?? info.total_rows ?? null,
            sample: Array.isArray(info.sample) ? info.sample : [],
            error: info.error || null,
        };
    });
};

const Upload = ({ onStart }) => {
    const [file, setFile] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [sheets, setSheets] = useState([]);
    const [sheetsInfo, setSheetsInfo] = useState([]);
    const [startingSheet, setStartingSheet] = useState(null);
    const [savedFilename, setSavedFilename] = useState(null);
    const [isRunning, setIsRunning] = useState(false);
    const [currentSheet, setCurrentSheet] = useState(null);
    const [completedSheets, setCompletedSheets] = useState([]);

    // ── Anotação automática no atendimento ───────────────────────────────
    const [noteOpen, setNoteOpen] = useState(false);
    const [selectedSheet, setSelectedSheet] = useState('');
    const [form, setForm] = useState(EMPTY_FORM);
    const [manualCol, setManualCol] = useState('');
    const [selection, setSelection] = useState({ start: 0, end: 0 });
    const [formatTarget, setFormatTarget] = useState(null);
    const [savingNote, setSavingNote] = useState(false);
    const [noteMsg, setNoteMsg] = useState(null);           // { type: 'ok' | 'erro', text }
    const [savedSheets, setSavedSheets] = useState([]);
    const [preview, setPreview] = useState(null);
    const [previewing, setPreviewing] = useState(false);
    const [previewError, setPreviewError] = useState(null);

    const noteRef = useRef(null);
    const formRef = useRef(form);
    const configCache = useRef({});    // sheetName -> form (não perde a edição ao trocar de aba)
    const chipsRef = useRef(null);

    useEffect(() => { formRef.current = form; }, [form]);

    // Fecha o popup de formato ao clicar fora
    useEffect(() => {
        if (!formatTarget) return;
        const onDocClick = (e) => {
            if (chipsRef.current && !chipsRef.current.contains(e.target)) setFormatTarget(null);
        };
        document.addEventListener('mousedown', onDocClick);
        return () => document.removeEventListener('mousedown', onDocClick);
    }, [formatTarget]);

    const seedConfigCache = (dispatchConfig, sheetNames) => {
        const first = sheetNames && sheetNames[0];
        if (!first || !dispatchConfig) return;
        configCache.current[first] = {
            noteTemplate: dispatchConfig.note_template || '',
            columnMapping: dispatchConfig.column_mapping && typeof dispatchConfig.column_mapping === 'object'
                ? dispatchConfig.column_mapping
                : {},
            intervalSeconds: dispatchConfig.interval_seconds ?? 1,
            manualColumns: [],
        };
    };

    React.useEffect(() => {
        const fetchUploadData = async () => {
            try {
                const res = await axios.get('/api/upload');
                if (res.data.has_file) {
                    setSavedFilename(res.data.filename);
                    setSheets(res.data.sheets || []);
                    setSheetsInfo(normalizeSheetsInfo(res.data.sheets_info, res.data.sheets || []));
                    seedConfigCache(res.data.dispatch_config, res.data.sheets || []);
                }
            } catch (err) { }
        };
        fetchUploadData();

        const fetchSystemStatus = async () => {
            try {
                const res = await axios.get('/api/status');
                const isSystemRunning = res.data.is_running;
                setIsRunning(isSystemRunning);

                const activeSheet = res.data.current_sheet || null;

                if (res.data.completed_sheets) {
                    setCompletedSheets(res.data.completed_sheets);
                }

                if (isSystemRunning) {
                    setCurrentSheet(activeSheet);
                } else {
                    setCurrentSheet(null);
                }
            } catch (e) { }
        };
        fetchSystemStatus();
        const interval = setInterval(fetchSystemStatus, 2000);
        return () => clearInterval(interval);
    }, []);

    // Primeira aba por padrão
    useEffect(() => {
        if (sheets.length === 0) {
            setSelectedSheet('');
            return;
        }
        setSelectedSheet((prev) => (sheets.includes(prev) ? prev : sheets[0]));
    }, [sheets]);

    // Carrega a anotação salva da aba selecionada
    useEffect(() => {
        if (!selectedSheet) return undefined;
        const cached = configCache.current[selectedSheet];
        if (cached) {
            setForm(cached);
            setNoteMsg(null);
            return undefined;
        }
        let alive = true;
        (async () => {
            try {
                const res = await axios.get('/api/dispatch/config', { params: { sheet_name: selectedSheet } });
                if (!alive) return;
                const d = res.data || {};
                const next = {
                    noteTemplate: d.note_template || '',
                    columnMapping: d.column_mapping && typeof d.column_mapping === 'object' ? d.column_mapping : {},
                    intervalSeconds: d.interval_seconds ?? 1,
                    manualColumns: [],
                };
                configCache.current[selectedSheet] = next;
                setForm(next);
                setNoteMsg(null);
            } catch (err) {
                if (!alive) return;
                setForm({ ...EMPTY_FORM });
                setNoteMsg(null);
            }
        })();
        return () => { alive = false; };
    }, [selectedSheet]);

    const infoBySheet = useMemo(() => {
        const map = {};
        sheets.forEach((name) => {
            map[name] = { name, columns: [], total: null, sample: [], error: null };
        });
        sheetsInfo.forEach((info) => { map[info.name] = info; });
        return map;
    }, [sheets, sheetsInfo]);

    const sheetInfo = selectedSheet ? infoBySheet[selectedSheet] : null;
    const hasSheetDetails = !!(sheetInfo && sheetInfo.columns.length > 0);

    const updateForm = useCallback((patch) => {
        setForm((prev) => ({ ...prev, ...patch }));
    }, []);

    const persistCurrentForm = useCallback((sheetName) => {
        if (!sheetName) return;
        configCache.current[sheetName] = { ...formRef.current };
    }, []);

    const handleSelectSheet = (sheetName) => {
        persistCurrentForm(selectedSheet);
        setSelectedSheet(sheetName);
        setPreview(null);
        setPreviewError(null);
        setFormatTarget(null);
    };

    const columns = useMemo(() => {
        const base = (sheetInfo && sheetInfo.columns) || [];
        const extras = (form.manualColumns || []).filter(
            (c) => !base.some((b) => String(b).toLowerCase() === String(c).toLowerCase())
        );
        return [...base, ...extras];
    }, [sheetInfo, form.manualColumns]);

    const placeholders = useMemo(() => usedPlaceholders(form.noteTemplate), [form.noteTemplate]);

    const trackSelection = (el) => {
        if (!el) return;
        const value = el.value || '';
        const start = el.selectionStart ?? value.length;
        const end = el.selectionEnd ?? start;
        setSelection({ start, end });
    };

    const insertColumn = (colName) => {
        const key = normalizeKey(colName);
        const token = `{${key}}`;
        const { start, end } = selection;
        const current = formRef.current.noteTemplate || '';
        const from = Math.max(0, Math.min(start, current.length));
        const to = Math.max(from, Math.min(end, current.length));
        const nextCaret = from + token.length;

        setForm((prev) => {
            const value = prev.noteTemplate || '';
            const s = Math.max(0, Math.min(from, value.length));
            const e = Math.max(s, Math.min(to, value.length));
            return {
                ...prev,
                noteTemplate: value.slice(0, s) + token + value.slice(e),
                columnMapping: {
                    ...prev.columnMapping,
                    [key]: prev.columnMapping[key] || { column: colName, format: 'text' },
                },
            };
        });
        setSelection({ start: nextCaret, end: nextCaret });
        requestAnimationFrame(() => {
            if (noteRef.current) {
                noteRef.current.focus();
                try { noteRef.current.setSelectionRange(nextCaret, nextCaret); } catch (e) { /* noop */ }
            }
        });
    };

    const setPlaceholderFormat = (key, format) => {
        setForm((prev) => ({
            ...prev,
            columnMapping: {
                ...prev.columnMapping,
                [key]: { column: (prev.columnMapping[key] || {}).column || key, format },
            },
        }));
        setFormatTarget(null);
    };

    const removePlaceholder = (key) => {
        setForm((prev) => {
            const mapping = { ...prev.columnMapping };
            delete mapping[key];
            return {
                ...prev,
                noteTemplate: (prev.noteTemplate || '').replace(new RegExp(`\\{${escapeRegExp(key)}\\}`, 'g'), ''),
                columnMapping: mapping,
            };
        });
        setFormatTarget(null);
    };

    const addManualColumn = (e) => {
        e.preventDefault();
        const name = (manualCol || '').trim();
        if (!name) return;
        setForm((prev) => {
            const key = normalizeKey(name);
            const already = (prev.manualColumns || []).some((c) => String(c).toLowerCase() === name.toLowerCase());
            return {
                ...prev,
                manualColumns: already ? prev.manualColumns : [...(prev.manualColumns || []), name],
                columnMapping: {
                    ...prev.columnMapping,
                    [key]: prev.columnMapping[key] || { column: name, format: 'text' },
                },
            };
        });
        setManualCol('');
    };

    // Contrato: { "nome": { "column": "nome", "format": "text" } }
    const buildColumnMapping = useCallback((tpl, columnMapping) => {
        const out = {};
        usedPlaceholders(tpl).forEach((key) => {
            const m = (columnMapping || {})[key] || {};
            out[key] = { column: m.column || key, format: m.format === 'money' ? 'money' : 'text' };
        });
        return out;
    }, []);

    const safeInterval = (raw) => {
        const n = Number(raw);
        return Number.isFinite(n) && n >= 0 ? n : 1;
    };

    const handleClear = async () => {
        try {
            await axios.delete('/api/upload');
            setSavedFilename(null);
            setFile(null);
            setSheets([]);
            setSheetsInfo([]);
            setSelectedSheet('');
            setForm({ ...EMPTY_FORM });
            setPreview(null);
            setPreviewError(null);
            setSavedSheets([]);
            configCache.current = {};
        } catch (err) {
            alert("Erro ao limpar arquivo.");
        }
    };

    const handleDragOver = (e) => {
        e.preventDefault();
    };

    const handleDrop = async (e) => {
        e.preventDefault();
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            setFile(e.dataTransfer.files[0]);
            await handleUpload(e.dataTransfer.files[0]);
        }
    };

    const handleFileChange = async (e) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
            await handleUpload(e.target.files[0]);
        }
    };

    const handleUpload = async (selectedFile) => {
        if (!selectedFile) return;
        setUploading(true);
        setSheets([]);
        const formData = new FormData();
        formData.append('file', selectedFile);

        try {
            const response = await axios.post('/api/upload', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            if (response.data.sheets) {
                const sheetNames = response.data.sheets || [];
                setSheets(sheetNames);
                setSheetsInfo(normalizeSheetsInfo(response.data.sheets_info, sheetNames));
                setSavedFilename(response.data.filename);
                seedConfigCache(response.data.dispatch_config, sheetNames);
                setSelectedSheet((prev) => (sheetNames.includes(prev) ? prev : (sheetNames[0] || '')));
            }
        } catch (err) {
            alert("Erro ao enviar arquivo: " + (err.response?.data?.detail || err.message));
            setFile(null);
        } finally {
            setUploading(false);
        }
    };

    const saveNote = async () => {
        if (!selectedSheet) return;
        setSavingNote(true);
        setNoteMsg(null);
        try {
            const interval = safeInterval(form.intervalSeconds);
            const payload = {
                sheet_name: selectedSheet,
                note_template: form.noteTemplate || '',
                column_mapping: buildColumnMapping(form.noteTemplate, form.columnMapping),
                interval_seconds: interval,
            };
            await axios.post('/api/dispatch/config', payload);
            const nextForm = { ...formRef.current, intervalSeconds: interval };
            configCache.current[selectedSheet] = nextForm;
            formRef.current = nextForm;
            setForm(nextForm);
            setSavedSheets((prev) => (prev.includes(selectedSheet) ? prev : [...prev, selectedSheet]));
            setNoteMsg({ type: 'ok', text: `Anotação salva para a aba "${selectedSheet}".` });
        } catch (err) {
            setNoteMsg({ type: 'erro', text: 'Erro ao salvar: ' + (err.response?.data?.detail || err.message) });
        } finally {
            setSavingNote(false);
        }
    };

    const runPreview = async () => {
        if (sheets.length === 0) {
            alert('Envie uma planilha primeiro.');
            return;
        }
        if (!selectedSheet) return;
        setPreviewing(true);
        setPreviewError(null);
        try {
            const res = await axios.get('/api/dispatch/preview', { params: { sheet_name: selectedSheet } });
            setPreview(res.data || null);
        } catch (err) {
            setPreview(null);
            setPreviewError('Erro ao simular: ' + (err.response?.data?.detail || err.message));
        } finally {
            setPreviewing(false);
        }
    };

    const handleStartSheet = async (sheetName) => {
        setStartingSheet(sheetName);
        try {
            const payload = { sheet_name: sheetName };
            const source = sheetName === selectedSheet ? formRef.current : configCache.current[sheetName];
            if (source) {
                payload.interval_seconds = safeInterval(source.intervalSeconds);
                payload.note_template = source.noteTemplate || '';
                payload.column_mapping = buildColumnMapping(source.noteTemplate, source.columnMapping);
            }
            await axios.post('/api/start', payload);
            if (onStart) onStart();
        } catch (err) {
            alert("Erro ao iniciar a aba: " + (err.response?.data?.detail || err.message));
        } finally {
            setStartingSheet(null);
        }
    };

    const sampleRows = (sheetInfo && sheetInfo.sample) || [];
    const previewRows = (preview && preview.linhas) || [];
    const intervalValue = safeInterval(form.intervalSeconds);

    return (
        <div className="p-8 h-full flex flex-col items-center justify-start space-y-8 overflow-y-auto">
            <div className="text-center mt-10">
                <h2 className="text-3xl font-bold text-white mb-2">Upload de Dados</h2>
                <p className="text-gray-400">Arraste e solte sua planilha (.xlsx) aqui para começar</p>
            </div>

            <div
                className="w-full max-w-2xl h-64 border-2 border-dashed border-dark-700 hover:border-lime-500 rounded-2xl bg-dark-800 flex flex-col items-center justify-center transition-colors cursor-pointer"
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onClick={() => document.getElementById('fileInput').click()}
            >
                <input
                    type="file"
                    id="fileInput"
                    className="hidden"
                    accept=".xlsx"
                    onChange={handleFileChange}
                />

                {uploading ? (
                    <div className="flex flex-col items-center text-lime-400 animate-pulse">
                        <UploadIcon size={64} className="mb-4" />
                        <p className="text-lg">Enviando e analisando planilhas...</p>
                    </div>
                ) : (file || savedFilename) ? (
                    <div className="flex flex-col items-center animate-in fade-in zoom-in duration-300">
                        <FileSpreadsheet size={64} className="text-lime-500 mb-4" />
                        <p className="text-xl font-medium text-white">{file ? file.name : savedFilename}</p>
                        {file && <p className="text-sm text-gray-500 mt-2">{(file.size / 1024).toFixed(2)} KB</p>}
                    </div>
                ) : (
                    <div className="flex flex-col items-center text-gray-500">
                        <UploadIcon size={64} className="mb-4 text-dark-600" />
                        <p className="text-lg">Clique ou Arraste o arquivo aqui</p>
                        <p className="text-sm mt-1">Formato suportado: .xlsx</p>
                    </div>
                )}
            </div>

            {sheets.length > 0 && (
                <div className="w-full max-w-4xl mt-8">
                    <div className="flex justify-between items-center mb-4 border-b border-white/10 pb-2">
                        <h3 className="text-xl font-semibold text-white">Planilhas Encontradas</h3>
                        <button onClick={handleClear} className="text-red-400 hover:text-red-300 flex items-center gap-1 text-sm font-medium transition-colors">
                            <RotateCcw size={16} /> Limpar Arquivo
                        </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {sheets.map((sheet) => {
                            const info = infoBySheet[sheet] || {};
                            return (
                                <div key={sheet} className="bg-dark-800 p-5 rounded-xl border border-white/10 flex flex-col justify-between hover:border-lime-500/50 transition-colors group">
                                    <div className="flex items-start space-x-3 mb-4">
                                        <div className="bg-lime-500/10 p-2 rounded-lg text-lime-400 shrink-0">
                                            <FileSpreadsheet size={24} />
                                        </div>
                                        <div className="min-w-0">
                                            <h4 className="text-lg font-medium text-white truncate" title={sheet}>{sheet}</h4>
                                            {info.total != null && (
                                                <p className="text-xs text-gray-400">{info.total} linhas · {info.columns.length} colunas</p>
                                            )}
                                        </div>
                                    </div>
                                    {savedSheets.includes(sheet) && (
                                        <p className="text-xs text-lime-400/90 mb-3 flex items-center gap-1.5">
                                            <StickyNote size={12} /> Anotação configurada
                                        </p>
                                    )}
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => handleStartSheet(sheet)}
                                            disabled={startingSheet === sheet || isRunning || completedSheets.includes(sheet)}
                                            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 ${completedSheets.includes(sheet)
                                                ? 'bg-dark-700 text-lime-500 cursor-not-allowed border border-lime-500/30'
                                                : isRunning && currentSheet === sheet
                                                    ? 'bg-lime-500 text-dark-900 cursor-not-allowed opacity-80'
                                                    : isRunning
                                                        ? 'bg-dark-700 text-gray-500 cursor-not-allowed'
                                                        : 'bg-lime-500 hover:bg-lime-400 text-dark-900'
                                                } rounded-lg font-bold text-sm transition-colors`}
                                        >
                                            {completedSheets.includes(sheet)
                                                ? 'Concluído'
                                                : startingSheet === sheet
                                                    ? 'Iniciando...'
                                                    : (isRunning && currentSheet === sheet)
                                                        ? 'Em Execução'
                                                        : <><Play size={16} fill="currentColor" /> {isRunning ? 'Aguarde...' : 'Disparar Aba'}</>}
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ── Anotação automática no atendimento ─────────────────────── */}
            <div className="w-full max-w-4xl bg-dark-800 rounded-xl border border-dark-700 overflow-hidden">
                <button
                    onClick={() => setNoteOpen((v) => !v)}
                    className="w-full flex items-center justify-between gap-3 p-5 hover:bg-dark-700/30 transition-colors text-left"
                >
                    <h3 className="text-xl font-bold text-white flex items-center gap-2">
                        <StickyNote size={20} className="text-lime-500" /> Anotação automática no atendimento
                    </h3>
                    <div className="flex items-center gap-3">
                        {selectedSheet && (
                            <span className="hidden sm:inline text-xs px-2.5 py-1 rounded-full bg-dark-900 border border-dark-700 text-gray-300">{selectedSheet}</span>
                        )}
                        {noteOpen ? <ChevronUp size={20} className="text-gray-400" /> : <ChevronDown size={20} className="text-gray-400" />}
                    </div>
                </button>

                {noteOpen && (
                    <div className="px-5 pb-5 pt-5 border-t border-dark-700 space-y-5">
                        {sheets.length === 0 && (
                            <div className="flex items-center gap-2 px-4 py-3 rounded-lg border bg-yellow-500/10 border-yellow-500/30 text-yellow-400 text-sm font-medium">
                                <Info size={16} /> Envie uma planilha primeiro para configurar a anotação.
                            </div>
                        )}

                        {/* Aba + intervalo */}
                        <div className="grid gap-4 md:grid-cols-2">
                            <div>
                                <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
                                    Aba da planilha
                                </label>
                                <select
                                    value={selectedSheet}
                                    onChange={(e) => handleSelectSheet(e.target.value)}
                                    disabled={sheets.length === 0}
                                    className="w-full bg-dark-900 border border-dark-700 text-white p-3 rounded-lg focus:outline-none focus:border-lime-500 disabled:opacity-50"
                                >
                                    {sheets.length === 0 && <option value="">Nenhuma aba carregada</option>}
                                    {sheets.map((s) => (
                                        <option key={s} value={s}>
                                            {s}{infoBySheet[s]?.total != null ? ` (${infoBySheet[s].total} linhas)` : ''}
                                        </option>
                                    ))}
                                </select>
                                {sheetInfo?.error && (
                                    <p className="text-yellow-400 text-xs mt-2">{sheetInfo.error}</p>
                                )}
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                    <Clock size={14} /> Intervalo entre envios (segundos)
                                </label>
                                <input
                                    type="number"
                                    min="0"
                                    step="0.5"
                                    value={form.intervalSeconds}
                                    onChange={(e) => updateForm({ intervalSeconds: e.target.value })}
                                    className="w-28 bg-dark-900 border border-dark-700 text-white p-3 rounded-lg focus:outline-none focus:border-lime-500 font-bold text-center"
                                />
                                <p className="text-gray-500 text-xs mt-2">
                                    1 segundo entre cada envio. Com 2 números, cada um envia a cada 2 segundos.
                                </p>
                            </div>
                        </div>

                        {/* Editor + preview */}
                        {hasSheetDetails && (
                            <div className="grid gap-4 lg:grid-cols-2">
                                <div>
                                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
                                        Colunas da aba (clique para inserir no texto)
                                    </p>
                                    <div className="flex flex-wrap gap-2 mb-3" ref={chipsRef}>
                                        {columns.map((col) => {
                                            const key = normalizeKey(col);
                                            const isUsed = placeholders.includes(key);
                                            return (
                                                <button
                                                    key={col}
                                                    type="button"
                                                    onClick={() => insertColumn(col)}
                                                    title={`Inserir {${key}}`}
                                                    className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${isUsed
                                                        ? 'bg-lime-500/20 border-lime-500/50 text-lime-400'
                                                        : 'bg-dark-900 border-dark-700 text-gray-400 hover:border-lime-500 hover:text-white'}`}
                                                >
                                                    {col}
                                                </button>
                                            );
                                        })}
                                    </div>

                                    <form onSubmit={addManualColumn} className="flex gap-2 mb-3">
                                        <input
                                            value={manualCol}
                                            onChange={(e) => setManualCol(e.target.value)}
                                            placeholder="Adicionar coluna manualmente"
                                            className="flex-1 bg-dark-900 border border-dark-700 text-white p-2.5 rounded-lg focus:outline-none focus:border-lime-500 text-sm"
                                        />
                                        <button
                                            type="submit"
                                            className="flex items-center justify-center gap-1.5 px-3 py-2 bg-dark-700 hover:bg-dark-600 text-gray-200 rounded-lg text-sm font-medium transition-colors"
                                        >
                                            <Plus size={16} /> <span className="hidden sm:inline">Adicionar</span>
                                        </button>
                                    </form>

                                    {placeholders.length > 0 && (
                                        <div className="mb-3">
                                            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">
                                                Formato de cada campo (clique para trocar)
                                            </p>
                                            <div className="flex flex-wrap gap-2">
                                                {placeholders.map((key) => {
                                                    const m = form.columnMapping[key] || { column: key, format: 'text' };
                                                    const open = formatTarget === key;
                                                    return (
                                                        <div key={key} className="relative">
                                                            <button
                                                                type="button"
                                                                onClick={() => setFormatTarget(open ? null : key)}
                                                                className={`flex items-center gap-1.5 font-mono text-xs pl-2.5 pr-2 py-1.5 rounded-lg border transition-colors ${m.format === 'money'
                                                                    ? 'bg-yellow-500/10 border-yellow-500/40 text-yellow-300 hover:bg-yellow-500/20'
                                                                    : 'bg-dark-900 border-dark-700 text-lime-400 hover:border-lime-500'} ${open ? 'ring-1 ring-lime-500' : ''}`}
                                                            >
                                                                {`{${key}}`}
                                                                {m.format === 'money' ? <DollarSign size={12} /> : <TypeIcon size={12} />}
                                                            </button>
                                                            {open && (
                                                                <div className="absolute z-30 left-0 top-full mt-1 w-60 bg-dark-900 border border-dark-700 rounded-lg shadow-xl p-1.5 space-y-1">
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => setPlaceholderFormat(key, 'text')}
                                                                        className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-xs font-medium transition-colors ${m.format !== 'money' ? 'bg-lime-500/15 text-lime-400' : 'text-gray-300 hover:bg-dark-700'}`}
                                                                    >
                                                                        <TypeIcon size={14} /> Texto <span className="text-gray-500">— valor como está</span>
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => setPlaceholderFormat(key, 'money')}
                                                                        className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-xs font-medium transition-colors ${m.format === 'money' ? 'bg-yellow-500/15 text-yellow-300' : 'text-gray-300 hover:bg-dark-700'}`}
                                                                    >
                                                                        <DollarSign size={14} /> Dinheiro <span className="text-gray-500">— R$ 1.500,50</span>
                                                                    </button>
                                                                    <div className="border-t border-dark-700 pt-1 mt-1">
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => removePlaceholder(key)}
                                                                            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors"
                                                                        >
                                                                            <X size={14} /> Remover do template
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    <textarea
                                        ref={noteRef}
                                        rows={8}
                                        value={form.noteTemplate}
                                        onChange={(e) => { updateForm({ noteTemplate: e.target.value }); trackSelection(e.target); }}
                                        onClick={trackSelection}
                                        onKeyUp={trackSelection}
                                        onSelect={trackSelection}
                                        onFocus={trackSelection}
                                        placeholder={'Ex.: Olá {nome}, segue o valor de {valor} — referência {pedido}.'}
                                        className="w-full bg-dark-900 border border-dark-700 text-white p-4 rounded-lg focus:outline-none focus:border-lime-500 font-mono text-sm resize-y"
                                    />
                                    <p className="text-gray-500 text-xs mt-2">
                                        A anotação fica no chat do contato para a pessoa do atendimento ver os dados da linha.
                                    </p>
                                </div>

                                <div>
                                    <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                        <Eye size={14} className="text-lime-500" /> Preview com as linhas da planilha
                                    </h4>
                                    {!form.noteTemplate ? (
                                        <div className="bg-dark-900 border border-dark-700 rounded-lg p-4 text-sm text-gray-500 italic min-h-[120px]">
                                            Monte o template ao lado para ver como a anotação fica.
                                        </div>
                                    ) : sampleRows.length === 0 ? (
                                        <div className="bg-dark-900 border border-dark-700 rounded-lg p-4 text-sm text-gray-500 italic min-h-[120px]">
                                            A aba não trouxe linhas de exemplo.
                                        </div>
                                    ) : (
                                        <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
                                            {sampleRows.slice(0, 5).map((row, i) => (
                                                <div key={i} className="bg-dark-900 border border-dark-700 rounded-lg p-3">
                                                    <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                                                        Linha {i + 1}{row && row.nome ? ` — ${row.nome}` : ''}
                                                    </p>
                                                    <p className="text-sm text-gray-300 font-mono whitespace-pre-wrap break-words">
                                                        {renderTemplate(form.noteTemplate, row, form.columnMapping)}
                                                    </p>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    <p className="text-gray-500 text-xs mt-2">
                                        Calculado aqui no navegador, sem chamar o backend a cada tecla.
                                    </p>
                                </div>
                            </div>
                        )}

                        {!hasSheetDetails && sheets.length > 0 && (
                            <div className="flex items-center gap-2 px-4 py-3 rounded-lg border bg-dark-900 border-dark-700 text-gray-400 text-sm font-medium">
                                <Info size={16} />
                                Esta resposta não trouxe as colunas da aba. Use “Simular” para conferir os dados antes de disparar.
                            </div>
                        )}

                        {/* Ações */}
                        <div className="flex flex-wrap items-center gap-3">
                            <button
                                onClick={saveNote}
                                disabled={savingNote || !selectedSheet}
                                className="flex items-center gap-2 px-5 py-2.5 bg-lime-500 hover:bg-lime-600 disabled:opacity-40 disabled:cursor-not-allowed text-dark-900 rounded-lg font-bold text-sm transition-colors"
                            >
                                <Save size={16} /> {savingNote ? 'Salvando...' : 'Salvar anotação'}
                            </button>
                            <button
                                onClick={runPreview}
                                disabled={previewing}
                                className="flex items-center gap-2 px-5 py-2.5 bg-dark-700 hover:bg-dark-600 disabled:opacity-60 text-gray-100 rounded-lg font-bold text-sm transition-colors"
                            >
                                <FlaskConical size={16} /> {previewing ? 'Simulando...' : 'Simular'}
                            </button>
                            {noteMsg && (
                                <div className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium ${noteMsg.type === 'ok'
                                    ? 'bg-lime-500/10 border-lime-500/30 text-lime-400'
                                    : 'bg-red-500/10 border-red-500/30 text-red-400'}`}
                                >
                                    {noteMsg.type === 'ok' ? <Check size={16} /> : <Info size={16} />}
                                    {noteMsg.text}
                                </div>
                            )}
                        </div>

                        {/* Resultado da simulação */}
                        {previewError && (
                            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border bg-red-500/10 border-red-500/30 text-red-400 text-sm font-medium">
                                <Info size={16} /> {previewError}
                            </div>
                        )}

                        {preview && (
                            <div className="space-y-3">
                                <div className="flex items-center justify-between gap-3 flex-wrap">
                                    <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                                        <Table2 size={14} className="text-lime-500" /> Como vai ser enviado
                                    </h4>
                                    <p className="text-xs text-gray-500">
                                        DDD de 11 a 29 usa 13 dígitos; os demais DDDs usam 12.
                                    </p>
                                </div>

                                <div className="overflow-x-auto rounded-lg border border-dark-700">
                                    <table className="w-full text-left text-sm">
                                        <thead className="bg-dark-900 text-gray-400 text-xs uppercase tracking-wider font-bold">
                                            <tr>
                                                <th className="px-4 py-3">Linha</th>
                                                <th className="px-4 py-3">Telefone</th>
                                                <th className="px-4 py-3">Nome</th>
                                                <th className="px-4 py-3">Número que será enviado</th>
                                                <th className="px-4 py-3">Dedup</th>
                                                <th className="px-4 py-3">Anotação</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-dark-700 bg-dark-800/40">
                                            {previewRows.length === 0 && (
                                                <tr>
                                                    <td colSpan={6} className="px-4 py-6 text-center text-gray-500 italic">
                                                        Nada para simular nesta aba.
                                                    </td>
                                                </tr>
                                            )}
                                            {previewRows.map((row, i) => {
                                                const formatted = Array.isArray(row.formatado) ? row.formatado : [];
                                                const short = formatted[0] || '';
                                                const long = formatted[1] || '';
                                                const decision = phoneDecision(short || long);
                                                const used = decision.usesNine ? (long || short) : (short || long);
                                                return (
                                                    <tr key={row.linha ?? i} className="hover:bg-dark-700/20 transition-colors">
                                                        <td className="px-4 py-3 text-gray-400 font-mono text-xs">{row.linha}</td>
                                                        <td className="px-4 py-3 text-gray-300 font-mono text-xs">{row.numero_bruto || '—'}</td>
                                                        <td className="px-4 py-3 text-white font-medium">{row.nome || '—'}</td>
                                                        <td className="px-4 py-3">
                                                            <div className="flex flex-col gap-1">
                                                                <div className="flex flex-wrap gap-1.5">
                                                                    {short && (
                                                                        <span
                                                                            title="12 dígitos"
                                                                            className={`font-mono text-[11px] px-2 py-0.5 rounded border ${decision.usesNine
                                                                                ? 'border-dark-700 bg-dark-900 text-gray-500'
                                                                                : 'border-lime-500/50 bg-lime-500/15 text-lime-300'}`}
                                                                        >
                                                                            {short}
                                                                        </span>
                                                                    )}
                                                                    {long && (
                                                                        <span
                                                                            title="13 dígitos"
                                                                            className={`font-mono text-[11px] px-2 py-0.5 rounded border ${decision.usesNine
                                                                                ? 'border-lime-500/50 bg-lime-500/15 text-lime-300'
                                                                                : 'border-dark-700 bg-dark-900 text-gray-500'}`}
                                                                        >
                                                                            {long}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                {used && (
                                                                    <p className="text-[11px] text-gray-400">
                                                                        <span className="text-lime-400 font-semibold">será usado: {used}</span>
                                                                        {` — ${decision.reason}`}
                                                                    </p>
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            {row.dedup_hoje ? (
                                                                <span className="text-xs px-2.5 py-1 rounded-full font-bold bg-yellow-500/15 text-yellow-400 border border-yellow-500/30 whitespace-nowrap">
                                                                    Já enviado (pulado)
                                                                </span>
                                                            ) : (
                                                                <span className="text-xs px-2.5 py-1 rounded-full font-bold bg-green-500/15 text-green-400 border border-green-500/30 whitespace-nowrap">
                                                                    Pode enviar
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-3 text-gray-300 text-xs whitespace-pre-wrap break-words max-w-xs">
                                                            {row.anotacao || '—'}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>

                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400">
                                    <span className="flex items-center gap-1.5">
                                        <FileSpreadsheet size={12} /> {preview.total_linhas ?? 0} linhas na planilha
                                    </span>
                                    <span className="flex items-center gap-1.5">
                                        <Clock size={12} /> intervalo de {String(intervalValue).replace('.', ',')} {intervalValue === 1 ? 'segundo' : 'segundos'} entre cada envio
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default Upload;