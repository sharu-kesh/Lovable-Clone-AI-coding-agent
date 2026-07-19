import React from 'react';

const BlockRow = ({ block, onChange }) => {
  const handleBlockChange = (e: React.FormEvent<HTMLDivElement>) => {
    onChange({ ...block, content: e.currentTarget.textContent || '' });
  };

  return (
    <div 
      className='block-row'
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        width: '100%',
        margin: '4px 0'
      }}
    > 
      <div
        contentEditable
        suppressContentEditableWarning
        onBlur={handleBlockChange}
        style={{
          flex: 1,
          outline: 'none',
          border: 'none',
          fontSize: '15px',
          lineHeight: '1.6',
          color: '#37352f',
          minHeight: '24px',
          wordBreak: 'break-word',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
        }}
      >
        {block.content}
      </div>
    </div>
  );
};

export default BlockRow;