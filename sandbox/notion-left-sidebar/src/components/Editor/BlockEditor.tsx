import React, { useState, useEffect } from 'react';
import { NotionContext } from '../../context/NotionContext';
import BlockRow from './BlockRow';

const BlockEditor = ({ page }) => {
  const { updatePage } = React.useContext<any>(NotionContext);
  const [blocks, setBlocks] = useState(page.blocks || []);
  const [title, setTitle] = useState(page.title);

  // Sync state when page changes
  useEffect(() => {
    setBlocks(page.blocks || []);
    setTitle(page.title);
  }, [page]);

  const handleTitleChange = (e: React.FormEvent<HTMLHeadingElement>) => {
    const newTitle = e.currentTarget.textContent || '';
    setTitle(newTitle);
    updatePage({ ...page, title: newTitle });
  };

  const handleBlockChange = (updatedBlock: any) => {
    const nextBlocks = blocks.map((b: any) => (b.id === updatedBlock.id ? updatedBlock : b));
    setBlocks(nextBlocks);
    updatePage({ ...page, blocks: nextBlocks });
  };

  return (
    <div className='block-editor' style={{ maxWidth: '720px', margin: '0 auto' }}> 
      {/* Cover placeholder */}
      {page.cover && (
        <div style={{ width: '100%', height: '180px', overflow: 'hidden', borderRadius: '8px', marginBottom: '24px' }}>
          <img src={page.cover} alt="Cover" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
      )}

      {/* Page Title */}
      <h1 
        contentEditable
        suppressContentEditableWarning
        onBlur={handleTitleChange}
        style={{
          fontSize: '36px',
          fontWeight: 700,
          color: '#37352f',
          outline: 'none',
          border: 'none',
          marginBottom: '28px',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
        }}
      >
        {title}
      </h1>

      {/* Blocks List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {blocks.length === 0 ? (
          <div style={{ color: '#8c8b88', fontSize: '14px' }}>Empty page. Type to add content...</div>
        ) : (
          blocks.map((block: any) => (
            <BlockRow key={block.id} block={block} onChange={handleBlockChange} />
          ))
        )}
      </div>
    </div>
  );
};

export default BlockEditor;