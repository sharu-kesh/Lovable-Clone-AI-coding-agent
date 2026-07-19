import React from 'react';
import { NotionContext } from '../../context/NotionContext';
import BlockEditor from './BlockEditor';

const EditorContainer = () => {
  const { activePage } = React.useContext<any>(NotionContext);

  return (
    <div 
      className='editor-container'
      style={{
        flex: 1,
        height: '100vh',
        overflowY: 'auto',
        padding: '60px 80px',
        backgroundColor: '#ffffff'
      }}
    > 
      {activePage ? (
        <BlockEditor page={activePage} />
      ) : (
        <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: '#8c8b88', fontSize: '15px' }}>
          Select or create a page to get started.
        </div>
      )}
    </div>
  );
};

export default EditorContainer;