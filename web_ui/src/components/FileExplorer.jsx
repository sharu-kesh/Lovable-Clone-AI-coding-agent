import React, { useRef, useState } from 'react';
import { RefreshCw, FileText, ChevronDown, FolderOpen, FileUp, Folder, ChevronRight, X, Trash2, Eye } from 'lucide-react';

export default function FileExplorer({ fileTree, selectedFile, onFileSelect, onRefresh }) {
  const folderInputRef = useRef(null);
  const fileInputRef = useRef(null);

  // Collapsed folders state mapping: { folderPath: boolean }
  const [collapsedFolders, setCollapsedFolders] = useState({});
  
  // Hidden paths (removed from view but not from disk) — persisted in localStorage
  const [hiddenPaths, setHiddenPaths] = useState(() => {
    const saved = localStorage.getItem('explorer_hidden_paths');
    return saved ? JSON.parse(saved) : {};
  });

  // Workspace dialog picker state
  const [pendingFiles, setPendingFiles] = useState(null);
  const [showWorkspacePrompt, setShowWorkspacePrompt] = useState(false);

  // Helper to color-code file icons based on extension
  const getFileIconStyle = (fileName) => {
    const ext = fileName.split('.').pop() || '';
    switch (ext.toLowerCase()) {
      case 'py':
        return { color: 'var(--green)' };
      case 'js':
      case 'jsx':
      case 'ts':
      case 'tsx':
        return { color: 'var(--blue)' };
      case 'java':
      case 'class':
        return { color: '#f87171' };
      case 'json':
      case 'yml':
      case 'yaml':
      case 'md':
        return { color: 'var(--amber)' };
      default:
        return { color: 'var(--text-secondary)' };
    }
  };

  // Skip useless/large folders during local folder load
  const shouldSkipPath = (path) => {
    const parts = path.split('/');
    return parts.some(p => [
      'node_modules', '.git', 'dist', '.next', '.venv', 'venv', 
      '__pycache__', '.idea', '.vscode', 'build', 'out'
    ].includes(p));
  };

  // Upload local files/directories to the sandbox backend
  const uploadFiles = async (filesList, clearExisting = false) => {
    const readPromises = [];
    
    for (let i = 0; i < filesList.length; i++) {
      const file = filesList[i];
      const relPath = file.webkitRelativePath || file.name;
      
      if (shouldSkipPath(relPath)) continue;

      readPromises.push(new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          resolve({
            path: relPath,
            content: e.target.result
          });
        };
        reader.onerror = () => resolve(null);
        reader.readAsText(file);
      }));
    }

    const payloadFiles = (await Promise.all(readPromises)).filter(Boolean);
    
    if (payloadFiles.length === 0) return;

    try {
      const res = await fetch('http://localhost:8000/api/sandbox/upload_tree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          files: payloadFiles,
          clear_existing: clearExisting
        })
      });
      if (res.ok) {
        onRefresh();
      } else {
        const err = await res.json();
        alert('Upload failed: ' + err.detail);
      }
    } catch (e) {
      alert('Failed to connect to backend: ' + e.message);
    }
  };

  const handleFilesSelected = (files) => {
    if (files && files.length > 0) {
      if (Object.keys(fileTree).length > 0) {
        setPendingFiles(files);
        setShowWorkspacePrompt(true);
      } else {
        uploadFiles(files, false);
      }
    }
  };

  const executeUploadChoice = (clearExisting) => {
    if (pendingFiles) {
      uploadFiles(pendingFiles, clearExisting);
    }
    setShowWorkspacePrompt(false);
    setPendingFiles(null);
  };

  const toggleFolder = (folderPath) => {
    setCollapsedFolders(prev => ({
      ...prev,
      [folderPath]: !prev[folderPath]
    }));
  };

  // Hide file or folder from view (doesn't delete from disk)
  const hidePath = (path) => {
    setHiddenPaths(prev => {
      const next = { ...prev, [path]: true };
      localStorage.setItem('explorer_hidden_paths', JSON.stringify(next));
      return next;
    });
  };

  // Delete file or folder permanently from disk (sends call to backend)
  const deletePathFromDisk = async (path, name, isFile) => {
    const itemType = isFile ? 'file' : 'folder';
    const confirmMessage = `⚠️ Are you sure you want to permanently delete the ${itemType} "${name}" from disk?\nThis action cannot be undone.`;
    
    if (window.confirm(confirmMessage)) {
      try {
        const res = await fetch('http://localhost:8000/api/sandbox/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path })
        });
        if (res.ok) {
          onRefresh();
        } else {
          const err = await res.json();
          alert('Delete failed: ' + err.detail);
        }
      } catch (e) {
        alert('Failed to delete file: ' + e.message);
      }
    }
  };

  // Helper to check if a path is hidden
  const isPathHidden = (path) => {
    return Object.keys(hiddenPaths).some(hidden => 
      path === hidden || path.startsWith(hidden + '/')
    );
  };

  const renderTree = (node, parentPath = '', level = 0) => {
    return Object.keys(node).sort().map(key => {
      const currentPath = parentPath ? `${parentPath}/${key}` : key;
      const isFile = node[key] === 'file';

      if (isPathHidden(currentPath)) return null;

      if (isFile) {
        return (
          <div 
            key={currentPath} 
            className={`file-item ${selectedFile === currentPath ? 'active' : ''}`}
            onClick={() => onFileSelect(currentPath)}
            style={{ paddingLeft: `${8 + level * 10}px` }}
          >
            <FileText size={13} style={getFileIconStyle(key)} />
            <span className="file-item-name">{key}</span>
            <div className="file-item-actions">
              <button 
                className="icon-btn small-action" 
                title="Remove from View (Keep on disk)"
                onClick={(e) => { e.stopPropagation(); hidePath(currentPath); }}
              >
                <X size={10} />
              </button>
              <button 
                className="icon-btn small-action danger" 
                title="Delete from Disk permanently"
                onClick={(e) => { e.stopPropagation(); deletePathFromDisk(currentPath, key, true); }}
              >
                <Trash2 size={10} />
              </button>
            </div>
          </div>
        );
      } else {
        const isCollapsed = !!collapsedFolders[currentPath];
        return (
          <div key={currentPath}>
            <div 
              className="folder-item" 
              style={{ paddingLeft: `${8 + level * 10}px`, cursor: 'pointer' }}
              onClick={() => toggleFolder(currentPath)}
            >
              {isCollapsed ? (
                <ChevronRight size={13} style={{ color: 'var(--text-muted)' }} />
              ) : (
                <ChevronDown size={13} style={{ color: 'var(--text-muted)' }} />
              )}
              <Folder size={13} style={{ color: '#fbbf24', marginRight: '2px' }} />
              <span>{key}</span>
              <div className="file-item-actions">
                <button 
                  className="icon-btn small-action" 
                  title="Remove Folder from View (Keep on disk)"
                  onClick={(e) => { e.stopPropagation(); hidePath(currentPath); }}
                >
                  <X size={10} />
                </button>
                <button 
                  className="icon-btn small-action danger" 
                  title="Delete Folder from Disk permanently"
                  onClick={(e) => { e.stopPropagation(); deletePathFromDisk(currentPath, key, false); }}
                >
                  <Trash2 size={10} />
                </button>
              </div>
            </div>
            {!isCollapsed && renderTree(node[key], currentPath, level + 1)}
          </div>
        );
      }
    });
  };

  const hasHiddenItems = Object.keys(hiddenPaths).length > 0;

  return (
    <div className="file-tree">
      {/* Hidden inputs to trigger picker */}
      <input 
        type="file" 
        ref={folderInputRef}
        webkitdirectory="" 
        directory="" 
        multiple 
        style={{ display: 'none' }}
        onChange={(e) => handleFilesSelected(e.target.files)}
      />
      <input 
        type="file" 
        ref={fileInputRef}
        multiple 
        style={{ display: 'none' }}
        onChange={(e) => handleFilesSelected(e.target.files)}
      />

      <div className="file-tree-header">
        <span className="file-tree-title">Workspace</span>
        <div className="file-tree-actions">
          {hasHiddenItems && (
            <button 
              className="icon-btn" 
              title="Show Hidden Items"
              onClick={() => {
                setHiddenPaths({});
                localStorage.removeItem('explorer_hidden_paths');
              }}
              style={{ color: 'var(--accent-2)' }}
            >
              <Eye size={13} />
            </button>
          )}
          <button 
            className="icon-btn" 
            title="Open Local Folder"
            onClick={() => folderInputRef.current?.click()}
          >
            <FolderOpen size={13} />
          </button>
          <button 
            className="icon-btn" 
            title="Open Local File(s)"
            onClick={() => fileInputRef.current?.click()}
          >
            <FileUp size={13} />
          </button>
          <button 
            className="icon-btn" 
            title="Sync Sandbox File tree (Refreshes view)"
            onClick={onRefresh}
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </div>
      
      <div className="file-tree-body">
        {Object.keys(fileTree).length === 0 ? (
          <div className="empty-state">
            <span>Empty Workspace</span>
          </div>
        ) : (
          renderTree(fileTree)
        )}
      </div>

      {/* VS Code Style Workspace import dialog */}
      {showWorkspacePrompt && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ width: '420px', height: 'auto', maxHeight: '300px' }}>
            <div className="modal-header">
              <span className="modal-title">Open Folder / Files</span>
              <button className="icon-btn" onClick={() => setShowWorkspacePrompt(false)}>
                <X size={14} />
              </button>
            </div>
            <div style={{ padding: '16px 20px', fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Would you like to open this folder in a new window (wiping the current workspace) or add it to the existing workspace?
            </div>
            <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid var(--border)' }}>
              <button className="btn" onClick={() => executeUploadChoice(true)}>
                Open in New Window (Wipe & Load)
              </button>
              <button className="btn secondary" onClick={() => executeUploadChoice(false)}>
                Add to Workspace (Combine)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
