import React from 'react';
import { NotionContext } from '../../context/NotionContext';
import PageTree from './PageTree';
import NewPageButton from './NewPageButton';

const Sidebar = () => {
  const { pages, sidebarCollapsed } = React.useContext<any>(NotionContext);
  const rootPages = pages.filter((p: any) => p.parentId === null);

  return (
    <div 
      className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}
      style={{
        width: sidebarCollapsed ? '0px' : '240px',
        height: '100vh',
        backgroundColor: '#f7f7f5',
        borderRight: '1px solid rgba(55, 53, 47, 0.09)',
        display: 'flex',
        flexDirection: 'column',
        padding: sidebarCollapsed ? '0px' : '16px 12px',
        overflow: 'hidden',
        transition: 'all 0.2s ease-in-out',
        flexShrink: 0
      }}
    > 
      {!sidebarCollapsed && (
        <>
          <div style={{ fontSize: '14px', fontWeight: 600, color: '#37352f', marginBottom: '16px', paddingLeft: '8px' }}>
            Workspace
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <PageTree pages={rootPages} allPages={pages} />
          </div>
          <NewPageButton />
        </>
      )}
    </div>
  );
};

export default Sidebar;