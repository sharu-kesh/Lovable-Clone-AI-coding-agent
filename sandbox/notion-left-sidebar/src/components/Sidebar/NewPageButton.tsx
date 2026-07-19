import React from 'react';
import { NotionContext } from '../../context/NotionContext';
import { Plus } from 'lucide-react';

export default function NewPageButton() {
  const { addPage, setActivePage } = React.useContext<any>(NotionContext);

  const handleAddPage = () => {
    const newPage = {
      id: Date.now().toString(),
      title: 'Untitled Page',
      icon: '📄',
      cover: 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809', // beautiful gradient cover
      blocks: [
        { id: Date.now().toString() + '-b1', type: 'text', content: 'Type / for commands...' }
      ],
      parentId: null,
      isExpanded: true,
      isFavorite: false
    };
    addPage(newPage);
    setActivePage(newPage);
  };

  return (
    <button 
      onClick={handleAddPage}
      style={{
        display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
        padding: '8px 12px', background: 'none', border: 'none',
        borderRadius: '6px', cursor: 'pointer', fontSize: '14px',
        color: '#5f5e5b', transition: 'background 0.15s', textAlign: 'left',
        marginTop: '12px', fontWeight: 500
      }}
      onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(55, 53, 47, 0.08)'}
      onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
    >
      <Plus size={16} />
      <span>New page</span>
    </button>
  );
}
