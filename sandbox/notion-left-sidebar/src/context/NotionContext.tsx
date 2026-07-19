import { createContext, useState, useEffect } from 'react';
import { Page, Block } from '../types';
const NotionContext = createContext();
const NotionProvider = ({ children }: { children: React.ReactNode }) => {
  const [pages, setPages] = useState<Page[]>([]);
  const [activePage, setActivePage] = useState<Page | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const storedPages = localStorage.getItem('pages');
    if (storedPages) {
      setPages(JSON.parse(storedPages));
    } else {
      // Load default templates
      setPages([
        { id: '1', title: '🚀 Getting Started', icon: '🚀', cover: 'https://example.com/cover1.jpg', blocks: [], parentId: null, isExpanded: true, isFavorite: false },
        { id: '2', title: '📅 Weekly Planner', icon: '📅', cover: 'https://example.com/cover2.jpg', blocks: [], parentId: null, isExpanded: true, isFavorite: false },
        { id: '3', title: '📚 Reading List', icon: '📚', cover: 'https://example.com/cover3.jpg', blocks: [], parentId: null, isExpanded: true, isFavorite: false },
      ]);
    }
  }, []);

  const addPage = (page: Page) => {
    setPages([...pages, page]);
    localStorage.setItem('pages', JSON.stringify(pages));
  };

  const updatePage = (page: Page) => {
    setPages(pages.map((p) => (p.id === page.id ? page : p)));
    localStorage.setItem('pages', JSON.stringify(pages));
  };

  const deletePage = (pageId: string) => {
    setPages(pages.filter((page) => page.id !== pageId));
    localStorage.setItem('pages', JSON.stringify(pages));
  };

  return (
    <NotionContext.Provider
      value={{ pages, activePage, sidebarCollapsed, searchQuery, addPage, updatePage, deletePage, setActivePage, setSidebarCollapsed, setSearchQuery }}
    >
      {children}
    </NotionContext.Provider>
  );
};
export { NotionProvider, NotionContext };