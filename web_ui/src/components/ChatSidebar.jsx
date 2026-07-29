import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Plus, Terminal, FileCode, FolderSearch, Play, HelpCircle, Trash2, FileDiff, ChevronDown, Square, Download, Archive, Pencil, Check, X } from 'lucide-react';

// ─── Slash Command Registry ───────────────────────────────────────────────────

const SLASH_COMMANDS = [
  {
    cmd: '/repo',
    icon: FolderSearch,
    label: '/repo',
    description: 'Analyze and summarize the entire repository structure',
    color: '#818cf8',
  },
  {
    cmd: '/file',
    icon: FileCode,
    label: '/file',
    description: 'Explain the currently open file in the editor',
    color: '#34d399',
  },
  {
    cmd: '/run',
    icon: Play,
    label: '/run',
    description: 'Run the currently open file in the sandbox terminal',
    color: '#fbbf24',
  },
  {
    cmd: '/explain',
    icon: HelpCircle,
    label: '/explain',
    description: 'Explain the last piece of generated code step by step',
    color: '#60a5fa',
  },
  {
    cmd: '/diff',
    icon: FileDiff,
    label: '/diff',
    description: 'Show the current content of the open file',
    color: '#f472b6',
  },
  {
    cmd: '/export',
    icon: Archive,
    label: '/export',
    description: 'Download the current project as a ZIP archive',
    color: '#a78bfa',
  },
  {
    cmd: '/clear',
    icon: Trash2,
    label: '/clear',
    description: 'Clear the current chat history and start fresh',
    color: '#f87171',
  },
];

// ─── Model List Registry ───────────────────────────────────────────────────────

const PROVIDER_COLORS = {
  github: '#f5f5f5',
  gemini: '#818cf8',
  groq: '#f472b6',
  together: '#fbbf24',
  mistral: '#34d399',
  openrouter: '#60a5fa',
  openai: '#a7f3d0',
  ollama: '#94a3b8',
};

const MODELS_REGISTRY = [
  {
    group: 'GitHub Models (Free demo tier)',
    provider: 'github',
    items: [
      { id: 'openai/gpt-4.1', name: 'GPT-4.1 via GitHub', desc: 'Tool calling; free prototyping quota' },
    ]
  },
  {
    group: 'Gemini (Recommended)',
    provider: 'gemini',
    items: [
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', desc: 'Recommended — stable, fast, no quota issues' },
      { id: 'gemini-flash-latest', name: 'Gemini Flash Latest', desc: '2.5-flash — smarter but may hit quota faster' },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', desc: 'Deep logic (requires Studio billing)' },
    ]
  },
  {
    group: 'Groq Cloud (Fastest Inference)',
    provider: 'groq',
    items: [
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', desc: 'Meta flagship versatile model' },
      { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B', desc: 'Ultra-fast, instant coding responses' },
    ]
  },
  {
    group: 'Together AI (Open Source)',
    provider: 'together',
    items: [
      { id: 'meta-llama/Llama-4-Scout-17B-16E-Instruct', name: 'Llama 4 Scout 17B', desc: 'Meta latest agent-optimized' },
      { id: 'Qwen/Qwen2.5-Coder-32B-Instruct', name: 'Qwen 2.5 Coder 32B', desc: 'Top-tier code completion' },
    ]
  },
  {
    group: 'Mistral AI',
    provider: 'mistral',
    items: [
      { id: 'mistral-medium-latest', name: 'Mistral Medium', desc: 'High reasoning capabilities' },
      { id: 'codestral-latest', name: 'Codestral', desc: 'Specialized 22B coding assistant' },
    ]
  },
  {
    group: 'Aggregators & Proprietary',
    provider: 'openrouter',
    items: [
      { id: 'openrouter/free', name: 'OpenRouter Auto (Free)', desc: 'Auto-routes to free models' },
    ]
  },
  {
    group: 'Paid Gateways',
    provider: 'openai',
    items: [
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', desc: 'Fast, cost-efficient OpenAI assistant' },
    ]
  },
  {
    group: 'Local Server',
    provider: 'ollama',
    items: [
      { id: 'qwen2.5-coder:14b', name: 'Ollama local', desc: 'Runs fully locally on your system' },
    ]
  }
];

// Helper to look up readable labels
const getModelLabel = (prov, modId) => {
  for (const group of MODELS_REGISTRY) {
    if (group.provider === prov) {
      const match = group.items.find(i => i.id === modId);
      if (match) return match.name;
    }
  }
  return `${prov}: ${modId}`;
};

// ─── Code Block Component ─────────────────────────────────────────────────────

function ChatCodeBlock({ lang, code }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Copy failed: ', err);
    }
  };

  return (
    <div style={{
      backgroundColor: '#090d12',
      border: '1px solid hsl(var(--border-color))',
      borderRadius: '6px',
      margin: '8px 0',
      overflow: 'hidden'
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '4px 10px',
        backgroundColor: 'rgba(255,255,255,0.03)',
        fontSize: '11px',
        color: 'hsl(var(--text-muted))',
        borderBottom: '1px solid hsl(var(--border-color))'
      }}>
        <span>{lang}</span>
        <button
          onClick={handleCopy}
          style={{
            background: 'none',
            border: 'none',
            color: copied ? '#a7f3d0' : 'inherit',
            cursor: 'pointer',
            fontSize: '11px',
            fontWeight: '500'
          }}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre style={{
        padding: '10px',
        fontSize: '12px',
        overflowX: 'auto',
        fontFamily: 'var(--font-mono)',
        color: 'hsl(var(--text-main))',
        whiteSpace: 'pre',
        textAlign: 'left',
        margin: 0,
      }}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

// ─── Message Renderer ─────────────────────────────────────────────────────────

function renderMessageText(text) {
  if (!text) return null;
  const parts = text.split(/(```[a-zA-Z0-9+#-]*\n[\s\S]*?\n```)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('```')) {
      const lines = part.split('\n');
      const lang = lines[0].replace('```', '').trim() || 'code';
      const code = lines.slice(1, -1).join('\n');
      return <ChatCodeBlock key={idx} lang={lang} code={code} />;
    }
    const boldParts = part.split(/(\*\*[^*]+\*\*)/g);
    return (
      <span key={idx}>
        {boldParts.map((bp, bi) => {
          if (bp.startsWith('**') && bp.endsWith('**')) {
            return <strong key={bi} style={{ display: 'inline', fontSize: 'inherit', textTransform: 'none', opacity: 1, letterSpacing: 'normal' }}>{bp.slice(2, -2)}</strong>;
          }
          return <span key={bi}>{bp}</span>;
        })}
      </span>
    );
  });
}

// ─── Slash Command Autocomplete ───────────────────────────────────────────────

function SlashCommandPopup({ query, onSelect, selectedIdx }) {
  const filtered = SLASH_COMMANDS.filter(c =>
    c.cmd.startsWith(query.toLowerCase())
  );
  if (filtered.length === 0) return null;

  return (
    <div style={{
      position: 'absolute',
      bottom: '100%',
      left: 0,
      right: 0,
      marginBottom: '6px',
      backgroundColor: '#12171f',
      border: '1px solid hsl(var(--border-color))',
      borderRadius: '10px',
      overflow: 'hidden',
      boxShadow: '0 -8px 32px rgba(0,0,0,0.5)',
      zIndex: 100,
    }}>
      <div style={{
        padding: '6px 10px',
        fontSize: '10px',
        color: 'hsl(var(--text-muted))',
        borderBottom: '1px solid hsl(var(--border-color))',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
      }}>
        Commands
      </div>
      {filtered.map((c, i) => {
        const Icon = c.icon;
        const isSelected = i === selectedIdx;
        return (
          <div
            key={c.cmd}
            onClick={() => onSelect(c.cmd)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '9px 12px',
              cursor: 'pointer',
              backgroundColor: isSelected ? 'rgba(255,255,255,0.06)' : 'transparent',
              borderBottom: i < filtered.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
              transition: 'background 0.1s',
            }}
          >
            <div style={{
              width: 28, height: 28, borderRadius: 6,
              backgroundColor: `${c.color}18`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <Icon size={14} color={c.color} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '13px', fontWeight: 500, color: c.color, fontFamily: 'var(--font-mono)' }}>
                {c.label}
              </div>
              <div style={{ fontSize: '11px', color: 'hsl(var(--text-muted))', marginTop: '1px' }}>
                {c.description}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main ChatSidebar ─────────────────────────────────────────────────────────

export default function ChatSidebar({
  sessionId, setSessionId,
  sessions, onCreateSession, onDeleteSession, onRenameSession, onDownloadProject,
  messages, chatInput, setChatInput,
  onSendMessage, onInterrupt, agentStatus, chatBottomRef,
  selectedFile,
  provider, setProvider,
  model, setModel,
  style
}) {
  const [slashQuery, setSlashQuery] = useState(null);
  const [slashSelectedIdx, setSlashSelectedIdx] = useState(0);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  // Inline rename state
  const [renamingSession, setRenamingSession] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef(null);
  const textareaRef = useRef(null);
  const dropdownRef = useRef(null);

  // Focus rename input when editing starts
  useEffect(() => {
    if (renamingSession && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingSession]);

  const startRename = () => {
    if (sessionId === 'new-chat') return;
    const sess = sessions.find(s => (s.id || s) === sessionId);
    setRenameValue(sess?.display_name || sessionId);
    setRenamingSession(true);
  };

  const confirmRename = () => {
    if (renameValue.trim()) onRenameSession?.(renameValue.trim());
    setRenamingSession(false);
  };

  const cancelRename = () => setRenamingSession(false);

  // Close model dropdown when clicking outside
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setModelDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const handleInputChange = useCallback((e) => {
    const val = e.target.value;
    setChatInput(val);

    const match = val.match(/^(\/\S*)$/);
    if (match) {
      setSlashQuery(match[1].toLowerCase());
      setSlashSelectedIdx(0);
    } else {
      setSlashQuery(null);
    }
  }, [setChatInput]);

  const handleSelectSlashCommand = useCallback((cmd) => {
    setChatInput(cmd + ' ');
    setSlashQuery(null);
    setSlashSelectedIdx(0);
    textareaRef.current?.focus();
  }, [setChatInput]);

  const selectModel = (prov, modId) => {
    setProvider(prov);
    setModel(modId);
    setModelDropdownOpen(false);
  };

  const handleKeyDown = useCallback((e) => {
    if (slashQuery !== null) {
      const filtered = SLASH_COMMANDS.filter(c => c.cmd.startsWith(slashQuery));
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashSelectedIdx(i => Math.min(i + 1, filtered.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashSelectedIdx(i => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && filtered.length > 0)) {
        e.preventDefault();
        if (filtered[slashSelectedIdx]) {
          handleSelectSlashCommand(filtered[slashSelectedIdx].cmd);
        }
        return;
      }
      if (e.key === 'Escape') {
        setSlashQuery(null);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSendMessage();
      setSlashQuery(null);
    }
  }, [slashQuery, slashSelectedIdx, handleSelectSlashCommand, onSendMessage]);

  return (
    <div className="panel chat-panel" style={style}>
      {/* Session Bar */}
      <div className="session-bar">
        {renamingSession ? (
          // ── Inline rename input ──────────────────────────────────────────
          <div style={{ display: 'flex', flex: 1, gap: '4px', alignItems: 'center' }}>
            <input
              ref={renameInputRef}
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') confirmRename();
                if (e.key === 'Escape') cancelRename();
              }}
              onBlur={confirmRename}
              style={{
                flex: 1, background: 'rgba(255,255,255,0.07)', border: '1px solid #818cf8',
                borderRadius: '6px', padding: '4px 8px', fontSize: '12px',
                color: 'hsl(var(--text-main))', outline: 'none',
              }}
            />
            <button onClick={confirmRename} className="btn secondary" title="Confirm" style={{ padding: '4px 6px' }}>
              <Check size={12} color="#34d399" />
            </button>
            <button onClick={cancelRename} className="btn secondary" title="Cancel" style={{ padding: '4px 6px' }}>
              <X size={12} color="#f87171" />
            </button>
          </div>
        ) : (
          // ── Normal session select ────────────────────────────────────────
          <>
            <select
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              className="select-input"
              style={{ flex: 1 }}
            >
              <option value="new-chat">New Chat</option>
              {sessions.filter(s => (s.id || s) !== 'new-chat').map(s => {
                const id = s.id || s;
                const label = s.display_name || id;
                return <option key={id} value={id}>{label}</option>;
              })}
            </select>
            {/* Rename button — double-click or click pencil icon */}
            <button
              onClick={startRename}
              className="btn secondary"
              title="Rename session"
              disabled={sessionId === 'new-chat'}
              style={{ padding: '4px 6px' }}
            >
              <Pencil size={12} style={{ color: sessionId === 'new-chat' ? 'var(--text-3)' : '#a78bfa' }} />
            </button>
          </>
        )}
        <button onClick={onCreateSession} className="btn secondary" title="New Session">
          <Plus size={14} />
        </button>
        <button
          onClick={onDownloadProject}
          className="btn secondary"
          title="Download project as ZIP"
          disabled={sessionId === 'new-chat'}
        >
          <Download size={13} style={{ color: sessionId === 'new-chat' ? 'var(--text-3)' : '#34d399' }} />
        </button>
        <button 
          onClick={onDeleteSession} 
          className="btn secondary" 
          title="Delete Conversation Session"
          disabled={sessionId === 'new-chat'}
        >
          <Trash2 size={13} style={{ color: sessionId === 'new-chat' ? 'var(--text-3)' : 'var(--red)' }} />
        </button>
      </div>

      {/* Chat History */}
      <div className="chat-history">
        {messages.length === 0 ? (
          <div style={{ textAlign: 'center', marginTop: '40px', padding: '0 16px' }}>
            <div style={{ color: 'hsl(var(--text-muted))', fontSize: '13px' }}>
              Type a request or use a <span style={{ color: '#818cf8', fontFamily: 'var(--font-mono)' }}>/command</span>
            </div>
            <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {SLASH_COMMANDS.slice(0, 3).map(c => {
                const Icon = c.icon;
                return (
                  <div
                    key={c.cmd}
                    onClick={() => handleSelectSlashCommand(c.cmd)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      padding: '6px 10px', borderRadius: '7px', cursor: 'pointer',
                      backgroundColor: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.06)',
                      fontSize: '12px', color: 'var(--text-secondary)',
                      transition: 'background 0.15s',
                    }}
                  >
                    <Icon size={12} color={c.color} />
                    <span style={{ color: c.color, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{c.cmd}</span>
                    <span>— {c.description}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          messages.map((m, idx) => (
            <div key={idx} className={`message-bubble ${m.sender}`}>
              <strong>{m.sender === 'user' ? 'You' : m.sender === 'agent' ? 'Agent' : 'System'}:</strong>
              <div style={{ marginTop: '4px', whiteSpace: 'pre-wrap' }}>
                {renderMessageText(m.text)}
              </div>
            </div>
          ))
        )}
        <div ref={chatBottomRef} />
      </div>

      {/* Input Area with Model Selector & slash commands */}
      <div className="chat-input-area" ref={dropdownRef}>
        {/* Model Switcher Bar */}
        <div 
          className="model-selector-bar"
          onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
        >
          <div className="model-provider-dot" style={{ backgroundColor: PROVIDER_COLORS[provider] || '#ccc' }} />
          <span className="model-name-text">
            {getModelLabel(provider, model)}
          </span>
          <ChevronDown size={11} className="model-chevron" />
        </div>

        {/* Model Switcher Dropdown */}
        {modelDropdownOpen && (
          <div className="model-dropdown-popup">
            {MODELS_REGISTRY.map(group => (
              <div key={group.group}>
                <div className="model-group-label">{group.group}</div>
                {group.items.map(item => {
                  const isSelected = provider === group.provider && model === item.id;
                  return (
                    <div 
                      key={item.id}
                      className={`model-option ${isSelected ? 'selected' : ''}`}
                      onClick={() => selectModel(group.provider, item.id)}
                    >
                      <div className="model-option-dot" style={{ backgroundColor: PROVIDER_COLORS[group.provider] }} />
                      <div className="model-option-info">
                        <div className="model-option-name">{item.id}</div>
                        <div className="model-option-desc">{item.desc}</div>
                      </div>
                      <span className="model-option-badge" style={{ backgroundColor: `${PROVIDER_COLORS[group.provider]}22`, color: PROVIDER_COLORS[group.provider] }}>
                        {group.provider}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {/* Slash Command autocomplete */}
        {slashQuery !== null && (
          <SlashCommandPopup
            query={slashQuery}
            onSelect={handleSelectSlashCommand}
            selectedIdx={slashSelectedIdx}
          />
        )}

        <textarea
          ref={textareaRef}
          className="chat-textarea"
          placeholder="Ask the agent, or type / for commands..."
          value={chatInput}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '6px' }}>
            {SLASH_COMMANDS.slice(0, 2).map(c => {
              const Icon = c.icon;
              return (
                <button
                  key={c.cmd}
                  onClick={() => handleSelectSlashCommand(c.cmd)}
                  title={c.description}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '4px',
                    padding: '3px 8px', borderRadius: '5px',
                    backgroundColor: `${c.color}15`,
                    border: `1px solid ${c.color}30`,
                    color: c.color, cursor: 'pointer',
                    fontSize: '11px', fontFamily: 'var(--font-mono)',
                  }}
                >
                  <Icon size={10} />
                  {c.label}
                </button>
              );
            })}
          </div>
          {agentStatus !== 'Idle' && agentStatus !== 'Error' ? (
            <button
              id="stop-agent-btn"
              onClick={onInterrupt}
              title="Stop generation"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '7px 14px',
                borderRadius: '8px',
                background: 'rgba(239,68,68,0.15)',
                border: '1px solid rgba(239,68,68,0.5)',
                color: '#ef4444',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 600,
                animation: 'stop-pulse 1.4s ease-in-out infinite',
              }}
            >
              <Square size={12} fill="#ef4444" />
              Stop
            </button>
          ) : (
            <button
              onClick={() => { onSendMessage(); setSlashQuery(null); }}
              className="btn"
              disabled={!chatInput.trim()}
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
