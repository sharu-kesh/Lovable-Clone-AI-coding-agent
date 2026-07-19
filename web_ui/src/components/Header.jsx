import React from 'react';
import { RefreshCw } from 'lucide-react';

export default function Header({ agentStatus, onCleanPort }) {
  const isIdle = agentStatus === 'Idle' || 
                 agentStatus === 'Coding step completed.' || 
                 agentStatus === 'Coding completed.' ||
                 agentStatus === 'Generation stopped by user.' ||
                 agentStatus === 'Max execution iterations reached.';

  const isPaused = agentStatus === 'Awaiting Plan Approval' || 
                   agentStatus === 'Paused for Diff Review' || 
                   agentStatus === 'Paused. Waiting for diff approval.';

  const isError = agentStatus === 'Error' || agentStatus?.startsWith('Error') || agentStatus?.startsWith('Failed');

  const dotClass = isIdle ? 'idle'
                 : isPaused ? 'paused'
                 : isError ? 'error'
                 : 'busy';

  return (
    <header className="app-header">
      <div className="logo-section">
        <div className="logo-mark">L</div>
        <span className="logo-text">Lovable</span>
        <span className="logo-badge">AI Agent</span>
      </div>

      <div className="header-actions">
        <div className="header-status">
          <div className={`status-dot ${dotClass}`} />
          <span style={{ color: 'var(--text-2)' }}>{agentStatus}</span>
        </div>

        <button onClick={onCleanPort} className="btn danger" title="Stop background processes">
          <RefreshCw size={12} />
          <span>Reset</span>
        </button>
      </div>
    </header>
  );
}
