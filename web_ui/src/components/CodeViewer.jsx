import React, { useState, useEffect } from 'react';
import { Copy, Check, Save } from 'lucide-react';

export default function CodeViewer({ selectedFile, fileContent, onFileSave }) {
  const [editedContent, setEditedContent] = useState('');
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  // Sync edit buffer whenever active file or backend content changes
  useEffect(() => {
    setEditedContent(fileContent || '');
  }, [fileContent, selectedFile]);

  const handleCopy = async () => {
    if (!editedContent) return;
    try {
      await navigator.clipboard.writeText(editedContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  const handleSave = async () => {
    if (!selectedFile || editedContent === fileContent || saving) return;
    setSaving(true);
    
    try {
      const res = await fetch('http://localhost:8000/api/sandbox/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: selectedFile,
          content: editedContent
        })
      });
      
      if (res.ok) {
        if (onFileSave) {
          onFileSave(selectedFile, editedContent);
        }
      } else {
        alert('Failed to save file content.');
      }
    } catch (e) {
      alert('Connection error saving file: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  // Process hotkeys: Ctrl+S to save, Tab to insert spaces
  const handleKeyDown = (e) => {
    // Ctrl + S (or Cmd + S) save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      handleSave();
      return;
    }

    // Intercept tab key to insert 2 spaces instead of moving focus
    if (e.key === 'Tab') {
      e.preventDefault();
      const textarea = e.target;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const value = textarea.value;
      
      const newValue = value.substring(0, start) + '  ' + value.substring(end);
      setEditedContent(newValue);
      
      // Restore cursor position on next tick
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      }, 0);
    }
  };

  const hasUnsavedChanges = selectedFile && editedContent !== fileContent;

  const renderBreadcrumbs = () => {
    if (!selectedFile) return <span>No file selected</span>;
    const parts = selectedFile.split('/');
    return (
      <div className="editor-breadcrumb">
        {parts.map((part, idx) => (
          <React.Fragment key={idx}>
            {idx > 0 && <span className="breadcrumb-sep">/</span>}
            <span className={idx === parts.length - 1 ? 'breadcrumb-file' : ''}>
              {part}
            </span>
          </React.Fragment>
        ))}
        {hasUnsavedChanges && (
          <span 
            title="Unsaved changes" 
            style={{ 
              color: 'var(--amber)', 
              fontSize: '14px', 
              marginLeft: '6px', 
              lineHeight: 1 
            }}
          >
            ●
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="editor-workspace">
      <div className="editor-header">
        {renderBreadcrumbs()}
        
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {hasUnsavedChanges && (
            <button 
              onClick={handleSave}
              className="btn success"
              disabled={saving}
              style={{ 
                height: '24px', 
                padding: '2px 8px', 
                fontSize: '11px', 
                display: 'flex', 
                alignItems: 'center', 
                gap: '4px' 
              }}
              title="Save changes (Ctrl+S)"
            >
              <Save size={11} />
              <span>{saving ? 'Saving...' : 'Save File'}</span>
            </button>
          )}

          {selectedFile && (
            <button 
              onClick={handleCopy}
              className="btn secondary"
              style={{ 
                height: '24px', 
                padding: '2px 8px', 
                fontSize: '11px', 
                display: 'flex', 
                alignItems: 'center', 
                gap: '4px',
                background: 'transparent'
              }}
              title="Copy file contents"
            >
              {copied ? (
                <>
                  <Check size={12} style={{ color: 'var(--green)' }} />
                  <span style={{ color: 'var(--green)' }}>Copied!</span>
                </>
              ) : (
                <>
                  <Copy size={11} />
                  <span>Copy Code</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
      
      {selectedFile ? (
        <textarea
          value={editedContent}
          onChange={(e) => setEditedContent(e.target.value)}
          onKeyDown={handleKeyDown}
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
            resize: 'none',
            outline: 'none',
            backgroundColor: 'transparent',
            color: 'var(--text-1)',
            fontFamily: 'var(--font-mono)',
            fontSize: '12.5px',
            lineHeight: '1.72',
            whiteSpace: 'pre',
            overflow: 'auto',
            padding: '16px 20px',
            margin: 0
          }}
          placeholder="Start writing code..."
        />
      ) : (
        <div className="empty-state">
          <span>Select a file from the tree to view and edit its content</span>
        </div>
      )}
    </div>
  );
}
