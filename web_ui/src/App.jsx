import React, { useState, useEffect, useRef } from 'react';
import Header from './components/Header';
import ChatSidebar from './components/ChatSidebar';
import FileExplorer from './components/FileExplorer';
import CodeViewer from './components/CodeViewer';
import PreviewTabs from './components/PreviewTabs';
import DiffModal from './components/DiffModal';
import DownloadModal from './components/DownloadModal';

const API_BASE = 'http://localhost:8000';

export default function App() {
  // Session States
  const [sessionId, setSessionId] = useState('new-chat');
  const [sessions, setSessions] = useState([]);
  
  // Model Settings
  const [provider, setProvider] = useState('gemini');
  const [model, setModel] = useState('gemini-2.0-flash');

  // Conversational States
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [plan, setPlan] = useState(null);
  
  // App UI Layout
  const [activeTab, setActiveTab] = useState('plan'); // plan, preview, terminal
  const [agentStatus, setAgentStatus] = useState('Idle');
  const [terminalLogs, setTerminalLogs] = useState('Dev Console initialized. Waiting for execution...');
  
  // File Explorer & Editor
  const [fileTree, setFileTree] = useState({});
  const [selectedFile, setSelectedFile] = useState('');
  const [fileContent, setFileContent] = useState('');
  const [previewPort, setPreviewPort] = useState('5174');

  // Option B: Code Diff Approval Modal State
  const [pendingDiff, setPendingDiff] = useState(null);
  const [diffEdits, setDiffEdits] = useState('');
  const [rejectionFeedback, setRejectionFeedback] = useState('');

  // Download Modal State — null = closed, string = project_dir being exported
  const [downloadModalProject, setDownloadModalProject] = useState(null);

  // Active Project Directory State for scoping terminal sessions
  const [activeProjectDir, setActiveProjectDir] = useState(null);

  const chatBottomRef = useRef(null);

  // Terminal Tab States (Landed from PreviewTabs to allow global chat-to-terminal execution)
  const [terminals, setTerminals] = useState([
    { id: 'term-1', name: 'Terminal 1', isRunning: false }
  ]);
  const [activeTermId, setActiveTermId] = useState('term-1');

  // Resizing States
  const [chatWidth, setChatWidth] = useState(330);
  const [previewWidth, setPreviewWidth] = useState(450);
  const [isResizingChat, setIsResizingChat] = useState(false);
  const [isResizingPreview, setIsResizingPreview] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 1024);

  // Monitor screen width to keep it responsive
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 1024);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Handle panel resizing
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (isResizingChat) {
        // Enforce min width 240px and max width 600px
        const newWidth = Math.max(240, Math.min(600, e.clientX));
        setChatWidth(newWidth);
      } else if (isResizingPreview) {
        // Enforce min width 280px and max width 700px
        const newWidth = Math.max(280, Math.min(700, window.innerWidth - e.clientX));
        setPreviewWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizingChat(false);
      setIsResizingPreview(false);
    };

    if (isResizingChat || isResizingPreview) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingChat, isResizingPreview]);

  // Load available sessions and check filesystem on mount
  useEffect(() => {
    fetchSessions();
    fetchFileTree();
  }, []);

  // Fetch session history when selected session changes
  useEffect(() => {
    if (sessionId && sessionId !== 'new-chat') {
      loadSessionDetails(sessionId);
    } else if (sessionId === 'new-chat') {
      setMessages([]);
      setPlan(null);
      setPendingDiff(null);
      setActiveProjectDir(null);
    }
  }, [sessionId]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchSessions = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/sessions`);
      const data = await res.json();
      // API now returns [{id, display_name, project_dir}, ...]
      setSessions(data.sessions || []);
    } catch (e) {
      console.error('Failed fetching saved sessions:', e);
    }
  };

  const loadSessionDetails = async (sid) => {
    try {
      const res = await fetch(`${API_BASE}/api/session/${sid}`);
      if (res.ok) {
        const data = await res.json();
        
        // Reconstruct chat history in UI
        const loadedMessages = [];
        data.history.forEach(msg => {
          if (msg.role === 'user') {
            loadedMessages.push({ sender: 'user', text: msg.content });
          } else if (msg.role === 'assistant') {
            loadedMessages.push({ sender: 'agent', text: msg.content });
          } else if (msg.role === 'tool') {
            loadedMessages.push({ sender: 'system', text: `Tool Call Result (${msg.name})` });
          }
        });
        
        setMessages(loadedMessages);
        setPlan(data.plan);
        setActiveProjectDir(data.project_dir || null);
        
        if (data.status === 'paused_for_diff' && data.pending_tool_call) {
          fetchPendingDiffDetails(sid, data.pending_tool_call);
        } else {
          setPendingDiff(null);
        }
      }
    } catch (e) {
      console.error('Failed loading session details:', e);
    }
  };

  const fetchPendingDiffDetails = async (sid, toolCall) => {
    try {
      const args = toolCall.args;
      const res = await fetch(`${API_BASE}/api/sandbox/file?path=${args.path}`);
      const data = await res.json();
      setPendingDiff({
        path: args.path,
        search_block: args.search_block,
        replace_block: args.replace_block,
        original_content: data.content,
        tool_call_id: tool_call.id
      });
      setDiffEdits(args.replace_block);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchFileTree = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/sandbox/files`);
      const data = await res.json();
      setFileTree(data.repo_map || {});
    } catch (e) {
      console.error('Failed to retrieve workspace files:', e);
    }
  };

  const loadFileContent = async (path) => {
    try {
      setSelectedFile(path);
      const res = await fetch(`${API_BASE}/api/sandbox/file?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      setFileContent(data.content);
    } catch (e) {
      setFileContent(`Error loading file: ${e.message}`);
    }
  };

  const handleFileSave = (path, content) => {
    setFileContent(content);
  };

  const readStream = async (response) => {
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            handleServerEvent(data);
          } catch (e) {
            console.error('Error parsing SSE line:', e);
          }
        }
      }
    }
    fetchFileTree();
  };

  const handleServerEvent = (event) => {
    switch (event.type) {
      case 'status':
        setAgentStatus(event.message);
        setTerminalLogs(prev => prev + `\n[STATUS] ${event.message}`);
        break;
        
      case 'thought':
        setMessages(prev => {
          if (prev.length > 0 && prev[prev.length - 1].sender === 'agent') {
            const updated = [...prev];
            updated[updated.length - 1].text += event.message;
            return updated;
          }
          return [...prev, { sender: 'agent', text: event.message }];
        });
        break;

      case 'plan':
        setPlan(event.content);
        setActiveTab('plan');
        setAgentStatus('Awaiting Plan Approval');
        break;

      case 'pending_diff':
        setPendingDiff(event);
        setDiffEdits(event.replace_block);
        setAgentStatus('Paused for Diff Review');
        break;

      case 'tool_result':
        setTerminalLogs(prev => prev + `\n[TOOL RESULT] ${JSON.stringify(event.result, null, 2)}`);
        fetchFileTree();
        break;

      case 'quick_response':
        // Inline response for simple code tasks and slash commands — no plan tab switch
        setMessages(prev => [...prev, { sender: 'agent', text: event.content }]);
        setAgentStatus('Idle');
        break;

      case 'interrupted':
        setMessages(prev => [...prev, { sender: 'agent', text: '⛔ Generation stopped by user.' }]);
        setAgentStatus('Idle');
        break;

      case 'error':
        setMessages(prev => [...prev, { sender: 'agent', text: `❌ Error: ${event.message}` }]);
        setAgentStatus('Error');
        break;

      default:
        break;
    }
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim()) return;
    
    let activeSid = sessionId;
    const userText = chatInput.trim();
    setChatInput('');
    setMessages(prev => [...prev, { sender: 'user', text: userText }]);
    setAgentStatus('Processing...');

    // Intercept /run slash command to execute directly in active terminal session
    if (userText.toLowerCase().startsWith('/run')) {
      if (!selectedFile) {
        setMessages(prev => [...prev, { sender: 'agent', text: '⚠️ No file is currently open. Select a file from the workspace tree first.' }]);
        setAgentStatus('Idle');
        return;
      }
      
      const ext = selectedFile.split('.').pop().toLowerCase();
      const runCommands = {
        'py': `python ${selectedFile}`,
        'js': `node ${selectedFile}`,
        'ts': `npx ts-node ${selectedFile}`,
        'java': `javac ${selectedFile} && java ${selectedFile.replace('.java', '')}`,
        'go': `go run ${selectedFile}`,
        'rb': `ruby ${selectedFile}`,
      };
      
      const cmd = runCommands[ext];
      if (!cmd) {
        setMessages(prev => [...prev, { sender: 'agent', text: `⚠️ Don't know how to run .${ext} files automatically in the terminal.` }]);
        setAgentStatus('Idle');
        return;
      }

      // Switch view tab to Dev Terminal
      setActiveTab('terminal');

      try {
        // Optimistically set the running flag to true to start logs polling
        setTerminals(prev => 
          prev.map(t => t.id === activeTermId ? { ...t, isRunning: true } : t)
        );

        const res = await fetch(`${API_BASE}/api/sandbox/terminal/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            terminal_id: activeTermId,
            command: cmd,
            project_dir: activeProjectDir
          })
        });
        
        if (res.ok) {
          setMessages(prev => [...prev, { sender: 'agent', text: `🚀 Running \`${cmd}\` inside the Dev Terminal.` }]);
        } else {
          setMessages(prev => [...prev, { sender: 'agent', text: `❌ Failed to execute run command on backend.` }]);
        }
      } catch (err) {
        setMessages(prev => [...prev, { sender: 'agent', text: `❌ Connection error: ${err.message}` }]);
      }

      setAgentStatus('Idle');
      return;
    }

    // If it is a new chat, auto-generate a readable session ID from the prompt words
    if (activeSid === 'new-chat') {
      const words = userText.toLowerCase().trim().replace(/[^a-z0-9\s]/g, '').split(/\s+/).slice(0, 4).filter(Boolean);
      const generatedName = words.length > 0 ? words.join('-') : `chat-${Date.now().toString().slice(-6)}`;
      
      // Ensure it is unique
      let finalName = generatedName;
      let counter = 1;
      while (sessions.some(s => (s.id || s) === finalName)) {
        finalName = `${generatedName}-${counter}`;
        counter++;
      }
      
      activeSid = finalName;
      setSessionId(finalName);
      setSessions(prev => [{ id: finalName, display_name: finalName, project_dir: '' }, ...prev]);
    }

    try {
      const response = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: activeSid,
          message: userText,
          provider,
          model,
          current_file: selectedFile || null,
        })
      });
      await readStream(response);
      fetchSessions();
      if (activeSid !== 'new-chat') {
        loadSessionDetails(activeSid);
      }
    } catch (e) {
      setMessages(prev => [...prev, { sender: 'agent', text: `Failed connecting to server: ${e.message}` }]);
      setAgentStatus('Idle');
    }
  };

  const handlePlanApproval = async (approved) => {
    setAgentStatus(approved ? 'Scaffolding Project...' : 'Regenerating Plan...');
    const feedback = rejectionFeedback;
    setRejectionFeedback('');
    
    try {
      const response = await fetch(`${API_BASE}/api/approve_plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          approved,
          feedback,
          provider,
          model
        })
      });
      setActiveTab('preview');
      await readStream(response);
      fetchSessions();
      loadSessionDetails(sessionId);
    } catch (e) {
      console.error(e);
      setAgentStatus('Error');
    }
  };

  const handleDiffResponse = async (approved) => {
    const feedback = rejectionFeedback;
    const custom_replace_block = approved ? diffEdits : null;
    
    setPendingDiff(null);
    setAgentStatus('Executing code changes...');
    setRejectionFeedback('');
    setDiffEdits('');

    try {
      const response = await fetch(`${API_BASE}/api/approve_diff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          approved,
          feedback,
          custom_replace_block,
          provider,
          model
        })
      });
      await readStream(response);
      fetchSessions();
      loadSessionDetails(sessionId);
      if (selectedFile) {
        loadFileContent(selectedFile);
      }
    } catch (e) {
      console.error(e);
      setAgentStatus('Error');
    }
  };

  const handleDeleteSession = async () => {
    if (sessionId === 'new-chat') return;
    const sessionObj = sessions.find(s => (s.id || s) === sessionId);
    const label = sessionObj?.display_name || sessionId;
    if (confirm(`Permanently delete the chat conversation "${label}"?`)) {
      try {
        const res = await fetch(`${API_BASE}/api/session/${sessionId}`, { method: 'DELETE' });
        if (res.ok) {
          setSessions(prev => prev.filter(s => (s.id || s) !== sessionId));
          setSessionId('new-chat');
          setMessages([]);
          setPlan(null);
          setPendingDiff(null);
        } else {
          alert('Delete failed');
        }
      } catch (e) {
        alert('Failed deleting session: ' + e.message);
      }
    }
  };

  const handleRenameSession = async (newName) => {
    if (!newName || !newName.trim() || sessionId === 'new-chat') return;
    try {
      const res = await fetch(`${API_BASE}/api/session/${sessionId}/rename`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: newName.trim() })
      });
      if (res.ok) {
        setSessions(prev => prev.map(s =>
          (s.id || s) === sessionId
            ? { ...(typeof s === 'object' ? s : { id: s }), display_name: newName.trim() }
            : s
        ));
      }
    } catch (e) {
      console.error('Failed to rename session:', e);
    }
  };

  const handleDownloadProject = () => {
    const sessionObj = sessions.find(s => (s.id || s) === sessionId);
    const projectDir = sessionObj?.project_dir;
    if (!projectDir) {
      alert('No active project found. Build a project first, then download.');
      return;
    }
    // Open the download modal instead of direct window.open
    setDownloadModalProject(projectDir);
  };

  const handleCreateNewSession = () => {
    setSessionId('new-chat');
  };

  const handleInterrupt = async () => {
    try {
      await fetch(`${API_BASE}/api/interrupt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId })
      });
      setAgentStatus('Idle');
      setMessages(prev => [...prev, { sender: 'agent', text: '⛔ Generation stopped by user.' }]);
    } catch (e) {
      console.error('Failed to interrupt agent:', e);
    }
  };

  const handleCleanPort = async () => {
    if (confirm('Are you sure you want to stop background processes and free port 5173?')) {
      try {
        const res = await fetch(`${API_BASE}/api/sandbox/clean`, { method: 'POST' });
        const data = await res.json();
        alert(data.message);
      } catch (e) {
        alert('Failed cleaning port: ' + e.message);
      }
    }
  };

  return (
    <div className="app-container">
      {/* Header config bar */}
      <Header 
        agentStatus={agentStatus}
        onCleanPort={handleCleanPort}
      />

      {/* Main Workspace Panels Layout */}
      <div className="workspace-grid">
        {/* Left chat panel */}
        <ChatSidebar 
          sessionId={sessionId}
          setSessionId={(id) => setSessionId(id)}
          sessions={sessions}
          onCreateSession={handleCreateNewSession}
          onDeleteSession={handleDeleteSession}
          onRenameSession={handleRenameSession}
          onDownloadProject={handleDownloadProject}
          messages={messages}
          chatInput={chatInput}
          setChatInput={setChatInput}
          onSendMessage={handleSendMessage}
          onInterrupt={handleInterrupt}
          agentStatus={agentStatus}
          chatBottomRef={chatBottomRef}
          selectedFile={selectedFile}
          provider={provider}
          setProvider={setProvider}
          model={model}
          setModel={setModel}
          style={isMobile ? {} : { width: chatWidth }}
        />

        <div 
          className={`resizer-handle ${isResizingChat ? 'resizing' : ''}`}
          onMouseDown={(e) => {
            e.preventDefault();
            setIsResizingChat(true);
          }}
        />

        {/* Center files and editor workspace panel */}
        <div className="panel code-panel">
          <FileExplorer 
            fileTree={fileTree}
            selectedFile={selectedFile}
            onFileSelect={loadFileContent}
            onRefresh={fetchFileTree}
          />
          <CodeViewer 
            selectedFile={selectedFile}
            fileContent={fileContent}
            onFileSave={handleFileSave}
          />
        </div>

        <div 
          className={`resizer-handle ${isResizingPreview ? 'resizing' : ''}`}
          onMouseDown={(e) => {
            e.preventDefault();
            setIsResizingPreview(true);
          }}
        />

        {/* Right Preview/Plan tabs panel */}
        <PreviewTabs 
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          plan={plan}
          rejectionFeedback={rejectionFeedback}
          setRejectionFeedback={setRejectionFeedback}
          onPlanApproval={handlePlanApproval}
          previewPort={previewPort}
          setPreviewPort={setPreviewPort}
          terminalLogs={terminalLogs}
          setTerminalLogs={setTerminalLogs}
          onRefresh={fetchFileTree}
          terminals={terminals}
          setTerminals={setTerminals}
          activeTermId={activeTermId}
          setActiveTermId={setActiveTermId}
          style={isMobile ? {} : { width: previewWidth }}
          projectDir={activeProjectDir}
        />
      </div>

      {/* Option B Modal: Popups for file modifications */}
      <DiffModal 
        pendingDiff={pendingDiff}
        diffEdits={diffEdits}
        setDiffEdits={setDiffEdits}
        rejectionFeedback={rejectionFeedback}
        setRejectionFeedback={setRejectionFeedback}
        onDiffResponse={handleDiffResponse}
      />

      {/* Download Modal: native save dialog with rename support */}
      {downloadModalProject && (
        <DownloadModal
          projectDir={downloadModalProject}
          apiBase={API_BASE}
          onClose={() => setDownloadModalProject(null)}
        />
      )}
    </div>
  );
}
