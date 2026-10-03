'use client';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { MixerTrack } from '@/lib/audio';
import { BROWSER_INSTRUMENTS, defaultBrowserInstrument } from '@/lib/browser-instruments';
import { instrumentSourceKey, pluginFingerprint } from '@/lib/instrument-plugins';
import {
  companionSnapshot, companionServerSnapshot, subscribeCompanion,
  connectCompanion, disconnectCompanion, rescanCompanion, editVst3, renderVst3,
} from '@/lib/plugin-companion';
import BrowserInstrumentControls from './browser-instrument-controls';
import { Pick, upload } from './helpers';

const SETUP = 'https://github.com/Doughboyfressh/session-site/releases/tag/session-companion-v0.1.0';
export default function PluginInstruments({ track, bpm, projectId = '', disabled = false, onChange, onActivity }: {
  track: MixerTrack;
  bpm: number;
  projectId?: string;
  disabled?: boolean;
  onChange: (patch: Partial<MixerTrack>) => void;
  onActivity?: (active: boolean) => void;
}) {
  const companion = useSyncExternalStore(subscribeCompanion, companionSnapshot, companionServerSnapshot);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [renderStatus, setRenderStatus] = useState({ signature: '', matches: false });
  const renderSignature = instrumentSourceKey(track) + ':' + bpm;
  const rendered = renderStatus.signature === renderSignature && renderStatus.matches;
  const job = useRef<AbortController | null>(null);
  const current = useRef({ track, bpm, projectId, disabled, onChange, onActivity });
  useLayoutEffect(() => { current.current = { track, bpm, projectId, disabled, onChange, onActivity }; });
  useEffect(() => () => {
    job.current?.abort();
    job.current = null;
    current.current.onActivity?.(false);
  }, []);
  useEffect(() => {
    if (disabled) job.current?.abort();
  }, [disabled]);
  useEffect(() => {
    let cancelled = false;
    if (track.plugin?.format === 'vst3' && track.plugin.freeze)
      void pluginFingerprint(track, bpm).then((fingerprint) => {
        if (!cancelled) setRenderStatus({ signature: renderSignature,
          matches: track.plugin?.format === 'vst3' && track.plugin.freeze?.fingerprint === fingerprint });
      }).catch(() => {});
    return () => { cancelled = true; };
  }, [track, bpm, renderSignature]);
  const run = async (label: string, operation: (signal: AbortSignal, check: () => void) => Promise<void>, musical = false) => {
    if (disabled || job.current) return;
    const controller = new AbortController();
    job.current = controller;
    const original = current.current;
    const check = () => {
      const next = current.current;
      if (controller.signal.aborted || next.disabled || next.projectId !== original.projectId ||
        next.bpm !== original.bpm || instrumentSourceKey(next.track) !== instrumentSourceKey(original.track))
        throw Error('This instrument or your editing access changed. Reopen the operation from the current project.');
    };
    setBusy(label); setError(''); setMessage('');
    if (musical) original.onActivity?.(true);
    try { await operation(controller.signal, check); }
    catch (problem) {
      if (!controller.signal.aborted)
        setError(problem instanceof Error ? problem.message : 'The instrument could not complete this action.');
    } finally {
      if (job.current === controller) {
        job.current = null;
        if (musical) current.current.onActivity?.(false);
        setBusy('');
      }
    }
  };
  const instrument = track.plugin;
  const installed = instrument?.format === 'vst3' && companion.plugins.some((plugin) => plugin.classId === instrument.classId);
  const mode = instrument?.format === 'browser' ? instrument.id : instrument?.format === 'vst3' ? 'vst3:' + instrument.classId : 'studio';
  return <div className="plugin-instruments">
    <div className="section-title">
      <div><h3>Instrument plugins</h3><p>Play SESSION synths in your browser or use installed VST3 instruments with the Windows companion.</p></div>
      <a className="button secondary" href={SETUP} target="_blank" rel="noreferrer">Companion setup</a>
    </div>
    <Pick label="Instrument engine" value={mode} disabled={disabled || !!busy}
      options={[
        { value: 'studio', label: track.sample ? 'Your sample' : 'Studio voices' },
        ...BROWSER_INSTRUMENTS.map((plugin) => ({ value: plugin.id, label: plugin.name })),
        ...(instrument?.format === 'vst3' && !installed ? [{ value: 'vst3:' + instrument.classId, label: instrument.name + ' · VST3' }] : []),
        ...companion.plugins.map((plugin) => ({ value: 'vst3:' + plugin.classId, label: plugin.name + ' · VST3' })),
      ]} onChange={(value) => {
        if (disabled || busy || value === mode) return;
        try {
          const browser = BROWSER_INSTRUMENTS.find((plugin) => plugin.id === value);
          const native = companion.plugins.find((plugin) => 'vst3:' + plugin.classId === value);
          if (value !== 'studio' && !browser && !native) throw Error('Choose an available instrument.');
          onChange({ sound: value === 'studio' ? 'keys' : undefined,
            sample: undefined, fileId: undefined, peaks: undefined, duration: undefined,
            plugin: browser ? defaultBrowserInstrument(browser.id) : native ? {
              format: 'vst3', version: 1, classId: native.classId, name: native.name, vendor: native.vendor,
            } : undefined });
          setError(''); setMessage('');
        } catch (problem) { setError(problem instanceof Error ? problem.message : 'Could not change the instrument.'); }
      }} />
    {instrument?.format === 'browser' && <BrowserInstrumentControls instrument={instrument}
      disabled={disabled || !!busy} onChange={(plugin) => {
        try { onChange({ plugin, peaks: undefined, duration: undefined }); setError(''); }
        catch (problem) { setError(problem instanceof Error ? problem.message : 'Could not edit this instrument.'); }
      }} />}
    <details className="companion-pairing" open={instrument?.format === 'vst3' && !companion.connected ? true : undefined}>
      <summary>{companion.connected ? 'Windows companion connected' : 'Connect installed VST3 instruments'}</summary>
      <p>Start the companion on your computer and paste its pairing code. Keep your plugins installed and licensed on that computer.</p>
      <p>Allow SESSION local network access when your browser asks. If an in-app browser blocks the connection, open SESSION in a regular browser on the same Windows computer.</p>
      {companion.connected ? <div className="actions">
        <button type="button" className="button secondary" disabled={disabled || !!busy}
          onClick={() => void run('Scanning installed instruments', async (signal) => {
            await rescanCompanion(signal); setMessage('Installed instruments refreshed.');
          })}>Rescan instruments</button>
        <button type="button" className="button secondary" disabled={!!busy}
          onClick={() => { disconnectCompanion(); setCode(''); setMessage('Companion disconnected. Rendered audio remains available in saved projects.'); }}>Disconnect</button>
      </div> : <div className="actions">
        <label className="field"><span>Companion pairing code</span><input type="password" value={code}
          autoComplete="off" spellCheck={false} maxLength={64} disabled={disabled || !!busy}
          onChange={(event) => setCode(event.target.value)} /></label>
        <button type="button" className="button primary" disabled={disabled || !!busy || !code.trim()}
          onClick={() => void run('Checking companion connection', async (signal) => {
            await connectCompanion(code, signal, (stage) => {
              if (!signal.aborted) setBusy(stage === 'scanning' ? 'Scanning installed instruments' : 'Checking companion connection');
            });
            setCode(''); setMessage('Companion connected.');
          })}>Connect companion</button>
      </div>}
    </details>
    {companion.connected && !companion.plugins.length && <p><output>No compatible instruments found. Install a licensed Windows x64 VST3 instrument in a standard plugin folder, then rescan.</output></p>}
    {companion.connected && companion.scanWarnings > 0 && <p><output>Some instruments or folders could not be scanned. Check your Windows x64 VST3 installation, then rescan.</output></p>}
    {instrument?.format === 'vst3' && <div className="native-instrument-actions">
      <p>{rendered ? 'Rendered audio is available to project collaborators without this plugin.' : 'Render the current notes so collaborators can play and export this instrument without the plugin.'}</p>
      <p>Open the companion editor to audition sounds live. Piano-roll playback and export render the saved instrument state before playing.</p>
      <div className="actions">
        <button type="button" className="button secondary" disabled={disabled || !!busy || !companion.connected || !installed}
          onClick={() => void run('Editing instrument — close its window to apply', async (signal, check) => {
            const state = await editVst3(instrument, bpm, signal); check();
            const file = new File([JSON.stringify(state)], 'instrument.session-vst3.json', { type: 'application/vnd.session.vst3-state+json' });
            const saved = await upload(file, 'plugin-state', { signal, projectId }); check();
            current.current.onChange({ plugin: { ...instrument, stateFileId: saved.id, freeze: undefined }, peaks: undefined, duration: undefined });
            setMessage('Instrument settings applied. Render the new sound for collaborators, then save your project.');
          }, true)}>Open VST3 editor</button>
        <button type="button" className="button primary" disabled={disabled || !!busy || !companion.connected || !installed || !track.notes?.length}
          onClick={() => void run('Rendering instrument', async (signal, check) => {
            const wav = await renderVst3(track, bpm, 44100, signal); check();
            if (wav.byteLength > 25 * 1024 * 1024) throw Error('This render exceeds 25 MB. Shorten the instrument score before saving its audio.');
            const fingerprint = await pluginFingerprint(track, bpm); check();
            const saved = await upload(new File([wav], 'instrument-render.wav', { type: 'audio/wav' }), 'audio', { signal, projectId }); check();
            current.current.onChange({ plugin: { ...instrument, freeze: { fileId: saved.id, fingerprint } }, peaks: undefined, duration: undefined });
            setMessage('Rendered audio attached. Save the project to keep it and share it with collaborators.');
          }, true)}>Render for collaborators</button>
      </div>
      {!installed && <p>Connect the computer where this instrument is installed to edit its sound or render changed notes.</p>}
    </div>}
    {busy && <div className="actions"><output>{busy}</output><button type="button" className="button secondary" onClick={() => job.current?.abort()}>Cancel</button></div>}
    {error && <p role="alert" className="error">{error}</p>}
    {message && <output>{message}</output>}
  </div>;
}
