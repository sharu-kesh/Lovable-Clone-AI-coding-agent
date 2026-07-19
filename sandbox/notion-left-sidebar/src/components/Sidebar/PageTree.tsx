import React from 'react';
import PageItem from './PageItem';

const PageTree = ({ pages, allPages }) => {
  const rootPages = pages || [];
  const fullList = allPages || [];

  return (
    <ul style={{ listStyleType: 'none', padding: 0, margin: 0 }}>
      {rootPages.map((page) => {
        const children = fullList.filter((p: any) => p.parentId === page.id);
        return (
          <li key={page.id} style={{ margin: '2px 0' }}> 
            <PageItem page={page} />
            {page.isExpanded && children.length > 0 && (
              <div style={{ paddingLeft: '12px', borderLeft: '1px solid rgba(55, 53, 47, 0.06)', marginLeft: '12px' }}>
                <PageTree pages={children} allPages={fullList} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
};

export default PageTree;