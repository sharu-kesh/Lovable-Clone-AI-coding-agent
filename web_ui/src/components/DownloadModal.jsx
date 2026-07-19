import React, { useState, useEffect, useRef } from 'react';
import { Download, FolderOpen, X, Archive, Loader } from 'lucide-react';

/**
 * DownloadModal
 *
 * Shows a dialog where the user can:
 *  1. Rename the ZIP filename before saving.
 *  2. Pick a destination folder via the native OS save dialog
 *     (uses `showSaveFilePicker` — Chrome/Edge only).
 *  3. Fall back to a standard anchor download if the API is unavailable (Firefox).
 *
 * Props:
 *  - projectDir  {string}   The project subfolder name (e.g. "notion-clone")
 *  - apiBase     {string}   Backend base URL (e.g. "http://localhost:8000")
 *  - onClose     {fn}       Called when the modal is dismissed
 */
export default function DownloadModal({ projectDir, apiBase, onClose }) {
  const [zipName, setZipName] = useState('');
  const [status, setStatus] = useState('idle'); // idle | fetching | saving | done | error
  const [errorMsg, setErrorMsg] = useState('');
  const inputRef = useRef(null);

  // Pre-fill the filename with the project slug when modal opens
  useEffect(() => {
    setZipName(projectDir || 'my-project');
    setTimeout(() => inputRef.current?.focus(), 80);
  }, [projectDir]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sanitize = (name) =>
    name.trim().replace(/[<>:"/\\|?*]/g, '-').replace(/\.zip$/i, '') || 'project';

  /**
   * Main download handler.
   * 1. Fetches the ZIP blob from the backend.
   * 2. If showSaveFilePicker is available (Chrome/Edge): opens the native OS
   *    save-as dialog with the user-chosen filename pre-filled, then writes
   *    the blob directly to the chosen path.
   * 3. Otherwise: triggers a standard <a download> to the browser's default
   *    downloads folder.
   */
  const handleDownload = async () => {
    const filename = sanitize(zipName) + '.zip';
    setStatus('fetching');
    setErrorMsg('');

    let blob;
    try {
      const res = await fetch(`${apiBase}/api/sandbox/export/${projectDir}`);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      blob = await res.blob();
    } catch (err) {
      setStatus('error');
      setErrorMsg(`Failed to fetch ZIP from server: ${err.message}`);
      return;
    }

    // --- Path 1: File System Access API (Chrome / Edge) ---
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        setStatus('saving');
        const fileHandle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: 'ZIP Archive', accept: { 'application/zip': ['.zip'] } }],
        });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        setStatus('done');
      } catch (err) {
        // User cancelled the dialog — not an error
        if (err.name === 'AbortError') {
          setStatus('idle');
        } else {
          setStatus('error');
          setErrorMsg(`Save failed: ${err.message}`);
        }
      }
      return;
    }

    // --- Path 2: Fallback anchor download (Firefox / Safari) ---
    try {
      setStatus('saving');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStatus('done');
    } catch (err) {
      setStatus('error');
      setErrorMsg(`Download failed: ${err.message}`);
    }
  };

  const isBusy = status === 'fetching' || status === 'saving';
  const hasFSAPI = typeof window.showSaveFilePicker === 'function';

  return (
    /* ── Backdrop ── */
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        backgroundColor: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {/* ── Dialog card ── */}
      <div style={{
        background: 'linear-gradient(145deg, #13191f 0%, #0e1318 100%)',
        border: '1px solid rgba(129,140,248,0.25)',
        borderRadius: '16px',
        boxShadow: '0 24px 64px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)',
        padding: '28px 32px',
        width: '420px',
        maxWidth: '94vw',
        position: 'relative',
      }}>

        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute', top: '14px', right: '14px',
            background: 'rgba(255,255,255,0.06)', border: 'none',
            borderRadius: '6px', cursor: 'pointer', padding: '4px 6px',
            color: '#94a3b8', display: 'flex', alignItems: 'center',
          }}
        >
          <X size={14} />
        </button>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
          <div style={{
            background: 'rgba(129,140,248,0.12)', borderRadius: '10px',
            padding: '8px', display: 'flex',
          }}>
            <Archive size={18} color="#818cf8" />
          </div>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#e2e8f0' }}>
              Download Project
            </div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
              {hasFSAPI
                ? 'Choose a name and destination folder'
                : 'Choose a name — saved to Downloads folder'}
            </div>
          </div>
        </div>

        {/* ZIP filename input */}
        <label style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '6px', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
          ZIP filename
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0' }}>
          <input
            ref={inputRef}
            value={zipName}
            onChange={(e) => setZipName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !isBusy) handleDownload(); }}
            disabled={isBusy}
            placeholder="project-name"
            style={{
              flex: 1,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(129,140,248,0.3)',
              borderRight: 'none',
              borderRadius: '8px 0 0 8px',
              padding: '9px 12px',
              fontSize: '13px',
              color: '#e2e8f0',
              outline: 'none',
              fontFamily: 'var(--font-mono, monospace)',
            }}
          />
          <span style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(129,140,248,0.3)',
            borderLeft: 'none',
            borderRadius: '0 8px 8px 0',
            padding: '9px 12px',
            fontSize: '13px',
            color: '#64748b',
            whiteSpace: 'nowrap',
            fontFamily: 'var(--font-mono, monospace)',
          }}>
            .zip
          </span>
        </div>

        {/* Browser support note */}
        {!hasFSAPI && (
          <div style={{
            marginTop: '10px',
            padding: '8px 12px',
            background: 'rgba(251,191,36,0.07)',
            border: '1px solid rgba(251,191,36,0.2)',
            borderRadius: '7px',
            fontSize: '11px',
            color: '#fbbf24',
            lineHeight: 1.5,
          }}>
            💡 <strong>Tip:</strong> For a native "Save As" dialog, open this app in Chrome or Edge.
            Firefox will save to your Downloads folder automatically.
          </div>
        )}

        {/* Error message */}
        {status === 'error' && (
          <div style={{
            marginTop: '10px',
            padding: '8px 12px',
            background: 'rgba(248,113,113,0.08)',
            border: '1px solid rgba(248,113,113,0.25)',
            borderRadius: '7px',
            fontSize: '12px',
            color: '#f87171',
          }}>
            {errorMsg}
          </div>
        )}

        {/* Success message */}
        {status === 'done' && (
          <div style={{
            marginTop: '10px',
            padding: '8px 12px',
            background: 'rgba(52,211,153,0.08)',
            border: '1px solid rgba(52,211,153,0.25)',
            borderRadius: '7px',
            fontSize: '12px',
            color: '#34d399',
          }}>
            ✅ Saved successfully as <strong>{sanitize(zipName)}.zip</strong>
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '10px', marginTop: '22px' }}>
          <button
            onClick={onClose}
            disabled={isBusy}
            style={{
              flex: 1, padding: '9px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '8px', cursor: 'pointer',
              fontSize: '13px', color: '#94a3b8',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.09)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
          >
            Cancel
          </button>
          <button
            onClick={handleDownload}
            disabled={isBusy || !zipName.trim()}
            style={{
              flex: 2, padding: '9px',
              background: isBusy
                ? 'rgba(129,140,248,0.3)'
                : 'linear-gradient(135deg, #818cf8 0%, #6366f1 100%)',
              border: 'none',
              borderRadius: '8px',
              cursor: isBusy ? 'not-allowed' : 'pointer',
              fontSize: '13px', fontWeight: 600,
              color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              transition: 'all 0.15s',
              boxShadow: isBusy ? 'none' : '0 4px 14px rgba(99,102,241,0.35)',
            }}
          >
            {isBusy ? (
              <>
                <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />
                {status === 'fetching' ? 'Zipping project...' : 'Opening save dialog...'}
              </>
            ) : hasFSAPI ? (
              <><FolderOpen size={14} /> Choose Save Location</>
            ) : (
              <><Download size={14} /> Download ZIP</>
            )}
          </button>
        </div>

        {/* Spin keyframe */}
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
