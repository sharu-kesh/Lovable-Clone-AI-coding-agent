import React, { useState, useRef, useEffect } from 'react';
import { RefreshCw, Check, X, Terminal, Globe, ClipboardList, Plus, Trash2, StopCircle } from 'lucide-react';

// ─── Markdown Renderer ────────────────────────────────────────────────────────
function renderMarkdown(text) {
  if (!text) return null;
  const lines = text.split('\n');
  const elements = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim() || 'code';
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      elements.push(
        <pre key={i} style={{
          background: 'rgba(0,0,0,0.35)', borderRadius: 7, padding: '10px 14px',
          fontSize: '11.5px', overflowX: 'auto', margin: '8px 0',
          border: '1px solid rgba(255,255,255,0.07)', color: '#a5f3fc',
          fontFamily: 'var(--font-mono)'
        }}>
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
      i++;
      continue;
    }

    // H1
    if (line.startsWith('# ')) {
      elements.push(<h1 key={i} style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-1)', margin: '16px 0 6px', borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>{inlineMarkdown(line.slice(2))}</h1>);
      i++; continue;
    }
    // H2
    if (line.startsWith('## ')) {
      elements.push(<h2 key={i} style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', margin: '14px 0 5px' }}>{inlineMarkdown(line.slice(3))}</h2>);
      i++; continue;
    }
    // H3
    if (line.startsWith('### ')) {
      elements.push(<h3 key={i} style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-2)', margin: '10px 0 4px' }}>{inlineMarkdown(line.slice(4))}</h3>);
      i++; continue;
    }

    // HR
    if (line.trim() === '---' || line.trim() === '***') {
      elements.push(<hr key={i} style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '12px 0' }} />);
      i++; continue;
    }

    // Checkbox unchecked: - [ ]
    if (/^\s*-\s+\[\s\]/.test(line)) {
      const label = line.replace(/^\s*-\s+\[\s\]\s*/, '');
      elements.push(
        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, margin: '4px 0', paddingLeft: (line.match(/^(\s*)/)?.[1].length || 0) * 4 }}>
          <span style={{ width: 16, height: 16, borderRadius: 4, border: '1.5px solid rgba(255,255,255,0.2)', flexShrink: 0, marginTop: 2, display: 'inline-block', background: 'rgba(255,255,255,0.04)' }} />
          <span style={{ color: 'var(--text-2)', fontSize: 12.5 }}>{inlineMarkdown(label)}</span>
        </div>
      );
      i++; continue;
    }
    // Checkbox checked: - [x]
    if (/^\s*-\s+\[[xX]\]/.test(line)) {
      const label = line.replace(/^\s*-\s+\[[xX]\]\s*/, '');
      elements.push(
        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, margin: '4px 0', paddingLeft: (line.match(/^(\s*)/)?.[1].length || 0) * 4 }}>
          <span style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0, marginTop: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#22c55e33', border: '1.5px solid #22c55e88' }}>
            <svg width="10" height="10" viewBox="0 0 10 10"><polyline points="1.5,5 4,7.5 8.5,2.5" fill="none" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </span>
          <span style={{ color: 'var(--text-3)', fontSize: 12.5, textDecoration: 'line-through' }}>{inlineMarkdown(label)}</span>
        </div>
      );
      i++; continue;
    }

    // Numbered list: 1. ...
    if (/^\s*\d+\.\s/.test(line)) {
      const label = line.replace(/^\s*\d+\.\s*/, '');
      const num = line.match(/^\s*(\d+)\./)?.[1] || '1';
      elements.push(
        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, margin: '3px 0', paddingLeft: (line.match(/^(\s*)/)?.[1].length || 0) * 4 }}>
          <span style={{ color: 'var(--accent-2)', fontSize: 11, fontWeight: 600, minWidth: 18, marginTop: 2 }}>{num}.</span>
          <span style={{ color: 'var(--text-2)', fontSize: 12.5 }}>{inlineMarkdown(label)}</span>
        </div>
      );
      i++; continue;
    }

    // Bullet list: - or * or +
    if (/^\s*[-*+]\s/.test(line)) {
      const label = line.replace(/^\s*[-*+]\s*/, '');
      const indent = (line.match(/^(\s*)/)?.[1].length || 0) * 4;
      elements.push(
        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, margin: '3px 0', paddingLeft: indent }}>
          <span style={{ color: 'var(--accent)', fontSize: 14, lineHeight: '16px', flexShrink: 0, marginTop: 1 }}>·</span>
          <span style={{ color: 'var(--text-2)', fontSize: 12.5 }}>{inlineMarkdown(label)}</span>
        </div>
      );
      i++; continue;
    }

    // Empty line → spacer
    if (line.trim() === '') {
      elements.push(<div key={i} style={{ height: 6 }} />);
      i++; continue;
    }

    // Normal paragraph
    elements.push(<p key={i} style={{ margin: '3px 0', color: 'var(--text-2)', fontSize: 12.5, lineHeight: 1.7 }}>{inlineMarkdown(line)}</p>);
    i++;
  }

  return elements;
}

function inlineMarkdown(text) {
  if (!text) return null;
  // Handle **bold**, `code`, and plain text segments
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} style={{ color: 'var(--text-1)', fontWeight: 600 }}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', padding: '1px 5px', borderRadius: 4 }}>{part.slice(1, -1)}</code>;
    }
    return <span key={i}>{part}</span>;
  });
}

export default function PreviewTabs({
  activeTab, setActiveTab,
  plan, rejectionFeedback, setRejectionFeedback, onPlanApproval,
  previewPort, setPreviewPort,
  terminalLogs, setTerminalLogs,
  onRefresh,
  terminals, setTerminals,
  activeTermId, setActiveTermId,
  style,
  projectDir
}) {
  const [logsCache, setLogsCache] = useState({ 'term-1': 'Terminal initialized.\n' });
  const [terminalInput, setTerminalInput] = useState('');
  
  const consoleEndRef = useRef(null);

  // Poll terminal logs from backend every 1.5 seconds when terminal tab is open
  const fetchLogs = async (termId) => {
    try {
      const res = await fetch(`http://localhost:8000/api/sandbox/terminal/logs?terminal_id=${termId}`);
      if (res.ok) {
        const data = await res.json();
        setLogsCache(prev => ({
          ...prev,
          [termId]: data.logs
        }));
        setTerminals(prev => 
          prev.map(t => t.id === termId ? { ...t, isRunning: data.is_running } : t)
        );
      }
    } catch (e) {
      console.error('Failed fetching terminal logs:', e);
    }
  };

  useEffect(() => {
    if (activeTab !== 'terminal') return;

    // Fetch once to load static logs when switching
    fetchLogs(activeTermId);

    const activeTerm = terminals.find(t => t.id === activeTermId);
    if (!activeTerm || !activeTerm.isRunning) return;

    // Only poll if a command is active in this terminal session
    const interval = setInterval(() => {
      fetchLogs(activeTermId);
    }, 1500);

    return () => clearInterval(interval);
  }, [activeTermId, activeTab, terminals]);

  // Auto-scroll to bottom of active terminal
  useEffect(() => {
    if (activeTab === 'terminal') {
      consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logsCache, activeTermId, activeTab]);

  const handleTerminalSubmit = async (e) => {
    if (e.key === 'Enter' && terminalInput.trim()) {
      e.preventDefault();
      const cmd = terminalInput;
      setTerminalInput('');

      // Add to log locally first for instant feedback
      setLogsCache(prev => ({
        ...prev,
        [activeTermId]: (prev[activeTermId] || '') + `\n$ ${cmd}\n`
      }));

      try {
        const res = await fetch('http://localhost:8000/api/sandbox/terminal/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            terminal_id: activeTermId,
            command: cmd,
            project_dir: projectDir
          })
        });
        
        if (res.ok) {
          // Optimistically flag terminal as running to kick off polling loop immediately
          setTerminals(prev => 
            prev.map(t => t.id === activeTermId ? { ...t, isRunning: true } : t)
          );
          // Immediately fetch output
          setTimeout(() => fetchLogs(activeTermId), 150);
          // Refresh explorer in case command changed directories
          onRefresh();
        } else {
          setLogsCache(prev => ({
            ...prev,
            [activeTermId]: (prev[activeTermId] || '') + `❌ Failed to execute command.\n`
          }));
        }
      } catch (err) {
        setLogsCache(prev => ({
          ...prev,
          [activeTermId]: (prev[activeTermId] || '') + `❌ Connection error: ${err.message}\n`
        }));
      }
    }
  };

  const createNewTerminal = async () => {
    const newId = `term-${Date.now()}`;
    const nextNum = terminals.length + 1;
    
    try {
      await fetch('http://localhost:8000/api/sandbox/terminal/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ terminal_id: newId })
      });
      
      setTerminals(prev => [...prev, { id: newId, name: `Terminal ${nextNum}`, isRunning: false }]);
      setLogsCache(prev => ({ ...prev, [newId]: 'Terminal initialized.\n' }));
      setActiveTermId(newId);
    } catch (e) {
      console.error(e);
    }
  };

  const killActiveTerminal = async () => {
    try {
      await fetch('http://localhost:8000/api/sandbox/terminal/kill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ terminal_id: activeTermId })
      });
      fetchLogs(activeTermId);
    } catch (e) {
      console.error(e);
    }
  };

  const deleteActiveTerminal = async () => {
    if (terminals.length <= 1) return;
    const toDeleteId = activeTermId;
    const remaining = terminals.filter(t => t.id !== toDeleteId);
    setActiveTermId(remaining[0].id);
    setTerminals(remaining);

    try {
      await fetch('http://localhost:8000/api/sandbox/terminal/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ terminal_id: toDeleteId })
      });
      setLogsCache(prev => {
        const copy = { ...prev };
        delete copy[toDeleteId];
        return copy;
      });
    } catch (e) {
      console.error(e);
    }
  };

  const activeLogs = logsCache[activeTermId] || 'Terminal initialized.\n';

  return (
    <div className="panel preview-panel" style={style}>
      <div className="tab-header">
        <div 
          className={`tab-btn ${activeTab === 'plan' ? 'active' : ''}`} 
          onClick={() => setActiveTab('plan')}
        >
          <ClipboardList size={13} />
          <span>Plan Checklist</span>
        </div>
        <div 
          className={`tab-btn ${activeTab === 'preview' ? 'active' : ''}`} 
          onClick={() => setActiveTab('preview')}
        >
          <Globe size={13} />
          <span>Live Preview</span>
        </div>
        <div 
          className={`tab-btn ${activeTab === 'terminal' ? 'active' : ''}`} 
          onClick={() => setActiveTab('terminal')}
        >
          <Terminal size={13} />
          <span>Dev Terminal</span>
        </div>
      </div>

      <div className="tab-content" style={{ height: 'calc(100% - 34px)', display: 'flex', flexDirection: 'column' }}>
        {activeTab === 'plan' && (
          <div style={{ padding: '20px', overflowY: 'auto', flex: 1, fontSize: '13px', lineHeight: '1.65' }}>
            {plan ? (
              <div>
                <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px', color: 'var(--text-1)' }}>
                  Implementation Plan Checklist
                </h3>
                <div style={{ backgroundColor: 'rgba(255,255,255,0.015)', padding: '16px 18px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                  {renderMarkdown(plan)}
                </div>
                
                <div style={{ borderTop: '1px solid var(--border)', marginTop: '16px', paddingTop: '16px' }}>
                  <p style={{ fontSize: '11.5px', color: 'var(--text-3)', marginBottom: '8px' }}>
                    Review the plan checklist. You can approve it to start scaffolding or reject with feedback.
                  </p>
                  <input 
                    type="text" 
                    placeholder="Optional feedback (e.g. 'Use plain CSS instead of Tailwind')" 
                    value={rejectionFeedback} 
                    onChange={(e) => setRejectionFeedback(e.target.value)}
                    className="text-input" 
                    style={{ width: '100%', marginBottom: '10px' }}
                  />
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => onPlanApproval(true)} className="btn success" style={{ flex: 1 }}>
                      <Check size={13} /> Approve & Build
                    </button>
                    <button onClick={() => onPlanApproval(false)} className="btn danger" style={{ flex: 1 }}>
                      <X size={13} /> Reject & Revise
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ color: 'var(--text-3)', fontSize: '12.5px', textAlign: 'center', marginTop: '80px' }}>
                No active design plan.
                <br/>
                Submit a prompt to generate a new checklist.
              </div>
            )}
          </div>
        )}

        {activeTab === 'preview' && (
          <div style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column' }}>
            <div className="preview-toolbar">
              <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>Local Address: http://localhost:</span>
              <input 
                type="text" 
                value={previewPort} 
                onChange={(e) => setPreviewPort(e.target.value)}
                className="text-input" 
                style={{ width: '50px', height: '20px', fontSize: '11px', padding: '1px 5px' }}
              />
              <button 
                onClick={() => {
                  const iframe = document.getElementById('preview-frame');
                  if (iframe) iframe.src = iframe.src;
                }} 
                style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                title="Refresh preview iframe"
              >
                <RefreshCw size={11} />
              </button>
            </div>
            {previewPort === '5173' ? (
              <div style={{ 
                flex: 1, 
                display: 'flex', 
                flexDirection: 'column', 
                alignItems: 'center', 
                justifyContent: 'center', 
                padding: '20px', 
                color: 'var(--text-3)', 
                textAlign: 'center',
                background: 'var(--bg-editor)'
              }}>
                <h4 style={{ color: 'var(--text-1)', fontSize: '13px', marginBottom: '8px' }}>Web Server Preview Offline</h4>
                <p style={{ fontSize: '11.5px', maxWidth: '280px', lineHeight: '1.45', margin: '0 auto 12px' }}>
                  The sandbox Vite dev server runs on port <strong>5174</strong> to avoid conflict with this dashboard.
                </p>
                <button 
                  onClick={() => setPreviewPort('5174')}
                  className="btn secondary"
                  style={{ fontSize: '11px', padding: '4px 10px', height: '24px' }}
                >
                  Switch to Sandbox Port 5174
                </button>
              </div>
            ) : (
              <iframe 
                id="preview-frame"
                className="preview-iframe" 
                src={`http://localhost:${previewPort}`} 
                title="App Sandbox Preview"
              />
            )}
          </div>
        )}

        {activeTab === 'terminal' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Terminal Session Navigation Toolbar */}
            <div 
              style={{
                height: '32px',
                background: 'var(--bg-panel)',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0 8px',
                flexShrink: 0
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <select 
                  value={activeTermId} 
                  onChange={(e) => setActiveTermId(e.target.value)}
                  className="select-input"
                  style={{ height: '22px', padding: '0 8px', fontSize: '11px', width: '120px', paddingRight: '22px', border: '1px solid var(--border-strong)' }}
                >
                  {terminals.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.name} {t.isRunning ? '●' : ''}
                    </option>
                  ))}
                </select>
                <button 
                  className="icon-btn" 
                  title="New Terminal Session" 
                  onClick={createNewTerminal}
                  style={{ width: '22px', height: '22px' }}
                >
                  <Plus size={12} />
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <button 
                  className="icon-btn" 
                  title="Kill Current Shell Process" 
                  onClick={killActiveTerminal}
                  style={{ width: '22px', height: '22px', color: 'var(--red)' }}
                >
                  <StopCircle size={12} />
                </button>
                <button 
                  className="icon-btn" 
                  title="Close Terminal Tab" 
                  onClick={deleteActiveTerminal}
                  disabled={terminals.length <= 1}
                  style={{ width: '22px', height: '22px' }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>

            <div className="terminal-console" style={{ flex: 1, margin: 0, paddingBottom: '8px' }}>
              {activeLogs}
              <div ref={consoleEndRef} />
            </div>

            {/* Interactive Shell Prompt Bar */}
            <div 
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 12px',
                background: 'rgba(0,0,0,0.25)',
                borderTop: '1px solid var(--border)',
                flexShrink: 0
              }}
            >
              <span style={{ color: 'var(--accent-2)', fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 'bold' }}>$</span>
              <input 
                type="text" 
                value={terminalInput}
                onChange={(e) => setTerminalInput(e.target.value)}
                onKeyDown={handleTerminalSubmit}
                placeholder="Type command here and press Enter..."
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-1)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px',
                  outline: 'none'
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
