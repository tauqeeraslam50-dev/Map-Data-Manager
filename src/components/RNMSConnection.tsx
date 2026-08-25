import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, CircleOff, Link2, RefreshCw, Server, Unplug } from 'lucide-react';

type ConnectionState = 'offline' | 'connecting' | 'online' | 'error';

interface HealthResponse {
  status?: string;
  service?: string;
  version?: string;
  [key: string]: unknown;
}

export default function RNMSConnection() {
  const [endpoint, setEndpoint] = useState('http://127.0.0.1:3010/api/health');
  const [state, setState] = useState<ConnectionState>('offline');
  const [lastChecked, setLastChecked] = useState<string>('Never');
  const [message, setMessage] = useState('Not connected to Radio Network Management System.');
  const [details, setDetails] = useState<HealthResponse | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const checkConnection = async () => {
    const url = endpoint.trim();
    if (!url) {
      setState('error');
      setMessage('Enter an RNMS health/API URL.');
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState('connecting');
    setMessage('Connecting to Radio Network Management System...');

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json, text/plain, */*' },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`RNMS returned HTTP ${response.status}`);
      }

      const contentType = response.headers.get('content-type') ?? '';
      const data = contentType.includes('application/json')
        ? await response.json()
        : { status: 'online', response: await response.text() };

      setDetails(data as HealthResponse);
      setState('online');
      setMessage('Connected to Radio Network Management System.');
      setLastChecked(new Date().toLocaleString());
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      setDetails(null);
      setState('error');
      setMessage(error instanceof Error ? error.message : 'Connection failed.');
      setLastChecked(new Date().toLocaleString());
    }
  };

  const disconnect = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState('offline');
    setDetails(null);
    setMessage('Disconnected from Radio Network Management System.');
    setLastChecked(new Date().toLocaleString());
  };

  useEffect(() => () => abortRef.current?.abort(), []);

  const statusLabel = state === 'online'
    ? 'ONLINE'
    : state === 'connecting'
      ? 'CONNECTING'
      : state === 'error'
        ? 'OFFLINE / ERROR'
        : 'OFFLINE';

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-slate-100 p-4">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <Server className="w-6 h-6 text-blue-700" />
                <h2 className="text-xl font-semibold text-slate-900">Radio Network Management System</h2>
              </div>
              <p className="mt-1 text-sm text-slate-500">Connect Map Data Manager to the RNMS application and monitor the connection state.</p>
            </div>
            <div className={`px-3 py-1.5 rounded-full text-xs font-bold tracking-wide ${state === 'online' ? 'bg-green-100 text-green-700' : state === 'connecting' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
              {state === 'online' ? <CheckCircle2 className="inline w-4 h-4 mr-1" /> : <CircleOff className="inline w-4 h-4 mr-1" />}
              {statusLabel}
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-4">
          <section className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <h3 className="font-semibold text-slate-800 mb-4">RNMS Connection</h3>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">RNMS Health / API URL</label>
            <input
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              disabled={state === 'connecting'}
              placeholder="http://127.0.0.1:3010/api/health"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex flex-wrap gap-3 mt-4">
              <button onClick={checkConnection} disabled={state === 'connecting'} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-700 text-white font-medium hover:bg-blue-800 disabled:opacity-50">
                {state === 'connecting' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                {state === 'connecting' ? 'Connecting...' : 'Connect / Test'}
              </button>
              <button onClick={disconnect} disabled={state === 'offline'} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-300 text-slate-700 font-medium hover:bg-slate-50 disabled:opacity-50">
                <Unplug className="w-4 h-4" /> Disconnect
              </button>
            </div>
            <div className={`mt-4 rounded-lg p-3 text-sm ${state === 'online' ? 'bg-green-50 text-green-800' : state === 'error' ? 'bg-red-50 text-red-800' : 'bg-slate-50 text-slate-600'}`}>
              {message}
            </div>
          </section>

          <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <h3 className="font-semibold text-slate-800 mb-4">Connection Information</h3>
            <dl className="space-y-3 text-sm">
              <div><dt className="text-slate-400">Status</dt><dd className="font-semibold text-slate-800">{statusLabel}</dd></div>
              <div><dt className="text-slate-400">Endpoint</dt><dd className="font-mono text-xs break-all text-slate-700">{endpoint || 'Not configured'}</dd></div>
              <div><dt className="text-slate-400">Last checked</dt><dd className="text-slate-700">{lastChecked}</dd></div>
              {details?.service && <div><dt className="text-slate-400">Service</dt><dd className="text-slate-700">{details.service}</dd></div>}
              {details?.version && <div><dt className="text-slate-400">Version</dt><dd className="text-slate-700">{details.version}</dd></div>}
            </dl>
          </section>
        </div>

        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-900">
          <strong>Integration status:</strong> The connection panel is ready for the RNMS health/API endpoint. Until RNMS exposes that endpoint, a failed test correctly remains <strong>OFFLINE / ERROR</strong>; this does not indicate a Map Data Manager map failure.
        </div>
      </div>
    </div>
  );
}
