import React from 'react';
import { NotionContext } from '../../context/NotionContext';

const PageItem = ({ page }) => {
  const { setActivePage, activePage } = React.useContext<any>(NotionContext);
  const isActive = activePage?.id === page.id;

  const handlePageClick = () => {
    setActivePage(page);
  };

  return (
    <div 
      className={`page-item ${isActive ? 'active' : ''}`}
      onClick={handlePageClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 8px',
        borderRadius: '6px',
        cursor: 'pointer',
        fontSize: '14px',
        color: isActive ? '#37352f' : '#5f5e5b',
        backgroundColor: isActive ? 'rgba(55, 53, 47, 0.08)' : 'transparent',
        transition: 'background 0.15s',
        marginBottom: '2px',
        fontWeight: isActive ? 500 : 400
      }}
      onMouseEnter={e => {
        if (!isActive) e.currentTarget.style.backgroundColor = 'rgba(55, 53, 47, 0.04)';
      }}
      onMouseLeave={e => {
        if (!isActive) e.currentTarget.style.backgroundColor = 'transparent';
      }}
    > 
      <span className='page-icon'>{page.icon}</span>
      <span className='page-title'>{page.title}</span>
    </div>
  );
};

export default PageItem;