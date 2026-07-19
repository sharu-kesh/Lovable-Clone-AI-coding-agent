import React from 'react';
import { X, Check, Edit3 } from 'lucide-react';

export default function DiffModal({ 
  pendingDiff, diffEdits, setDiffEdits, 
  rejectionFeedback, setRejectionFeedback, onDiffResponse 
}) {
  if (!pendingDiff) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <header className="modal-header">
          <span className="modal-title">
            <strong>Step-by-Step Code Review:</strong> Proposed changes to <code>{pendingDiff.path}</code>
          </span>
          <button onClick={() => onDiffResponse(false)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>
            <X size={16} />
          </button>
        </header>

        <div className="diff-layout">
          {/* Left Side: Original Code with Search Block Highlighted */}
          <div className="diff-pane original">
            <div style={{ fontSize: '11px', color: 'hsl(var(--text-muted))', paddingBottom: '6px', borderBottom: '1px solid hsl(var(--border-color))', marginBottom: '8px' }}>
              ORIGINAL SOURCE CODE
            </div>
            <div style={{ whiteSpace: 'pre' }}>
              {pendingDiff.original_content ? (
                (() => {
                  const searchStr = pendingDiff.search_block;
                  const origStr = pendingDiff.original_content;
                  const index = origStr.indexOf(searchStr);

                  if (index !== -1 && searchStr) {
                    const before = origStr.slice(0, index);
                    const match = origStr.slice(index, index + searchStr.length);
                    const after = origStr.slice(index + searchStr.length);

                    return (
                      <>
                        {before}
                        <span className="diff-line removed">{match}</span>
                        {after}
                      </>
                    );
                  }
                  return origStr;
                })()
              ) : (
                <span style={{ color: 'hsl(var(--text-muted))' }}>[Creating brand new file]</span>
              )}
            </div>
          </div>

          {/* Right Side: Interactive Proposed Textarea */}
          <div className="diff-pane" style={{ borderLeft: '1px solid hsl(var(--border-color))', display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: '11px', color: 'hsl(var(--text-muted))', paddingBottom: '6px', borderBottom: '1px solid hsl(var(--border-color))', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>PROPOSED MODIFICATION (EDITABLE)</span>
              <span style={{ fontSize: '10px', color: '#ffb020' }}>You can edit this code directly!</span>
            </div>
            
            <textarea 
              value={diffEdits} 
              onChange={(e) => setDiffEdits(e.target.value)}
              style={{
                flex: 1,
                width: '100%',
                backgroundColor: 'rgba(0,0,0,0.15)',
                border: '1px solid hsl(var(--border-color))',
                borderRadius: '4px',
                color: '#bbf7d0',
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                padding: '8px',
                lineHeight: '1.5',
                resize: 'none',
                outline: 'none'
              }}
            />
          </div>
        </div>

        {/* Action Controls Footer */}
        <footer style={{ padding: '12px 16px', borderTop: '1px solid hsl(var(--border-color))', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input 
              type="text" 
              placeholder="Feedback comments for rejection (e.g. 'Add a shadow effect to this card before writing')" 
              value={rejectionFeedback} 
              onChange={(e) => setRejectionFeedback(e.target.value)}
              className="text-input" 
              style={{ flex: 1 }}
            />
            <button onClick={() => onDiffResponse(false)} className="btn danger">
              <X size={14} /> Reject Edit
            </button>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button 
              onClick={() => onDiffResponse(true)} 
              className="btn success" 
              style={{ flex: 1 }}
            >
              <Check size={14} /> Approve & Write Code
            </button>
            {diffEdits !== pendingDiff.replace_block && (
              <button 
                onClick={() => onDiffResponse(true)} 
                className="btn" 
                style={{ flex: 1, backgroundColor: '#3b82f6' }}
              >
                <Edit3 size={14} /> Approve with My Edits
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
