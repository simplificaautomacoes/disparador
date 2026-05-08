import React, { useState } from 'react';
import axios from 'axios';
import { Upload as UploadIcon, FileSpreadsheet, Play, RotateCcw } from 'lucide-react';

const Upload = ({ onStart }) => {
    const [file, setFile] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [sheets, setSheets] = useState([]);
    const [startingSheet, setStartingSheet] = useState(null);
    const [savedFilename, setSavedFilename] = useState(null);
    const [isRunning, setIsRunning] = useState(false);
    const [currentSheet, setCurrentSheet] = useState(null);
    const [completedSheets, setCompletedSheets] = useState([]);

    React.useEffect(() => {
        const fetchUploadData = async () => {
            try {
                const res = await axios.get('/api/upload');
                if (res.data.has_file) {
                    setSavedFilename(res.data.filename);
                    setSheets(res.data.sheets);
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

    const handleClear = async () => {
        try {
            await axios.delete('/api/upload');
            setSavedFilename(null);
            setFile(null);
            setSheets([]);
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
                setSheets(response.data.sheets);
                setSavedFilename(response.data.filename);
            }
        } catch (err) {
            alert("Erro ao enviar arquivo: " + (err.response?.data?.detail || err.message));
            setFile(null);
        } finally {
            setUploading(false);
        }
    };

    const handleStartSheet = async (sheetName) => {
        setStartingSheet(sheetName);
        try {
            await axios.post('/api/start', { sheet_name: sheetName });
            if (onStart) onStart();
        } catch (err) {
            alert("Erro ao iniciar a aba: " + err.message);
        } finally {
            setStartingSheet(null);
        }
    };

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
                        <UploadIcon size={64} className="mb-4 text-gray-600" />
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
                        {sheets.map((sheet) => (
                            <div key={sheet} className="bg-dark-800 p-5 rounded-xl border border-white/10 flex flex-col justify-between hover:border-lime-500/50 transition-colors group">
                                <div className="flex items-center space-x-3 mb-4">
                                    <div className="bg-lime-500/10 p-2 rounded-lg text-lime-400">
                                        <FileSpreadsheet size={24} />
                                    </div>
                                    <h4 className="text-lg font-medium text-white truncate" title={sheet}>{sheet}</h4>
                                </div>
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
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default Upload;
