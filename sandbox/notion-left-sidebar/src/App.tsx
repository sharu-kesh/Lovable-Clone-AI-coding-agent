import React from 'react';
import { NotionProvider } from './context/NotionContext';
import Sidebar from './components/Sidebar/Sidebar';
import EditorContainer from './components/Editor/EditorContainer';

export default function App() {
  return (
    <NotionProvider>
      <div style={{ display: 'flex', width: '100vw', height: '100vh', overflow: 'hidden', backgroundColor: '#ffffff', color: '#37352f' }}>
        <Sidebar />
        <EditorContainer />
      </div>
    </NotionProvider>
  );
}
