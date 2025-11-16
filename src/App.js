import React, { useState, useEffect, useCallback } from 'react';
// FilterBar removed from topbar per user request
import AuthModal from './components/AuthModal';
import NotesList from './components/NotesList';
import notesApi from './services/notesApi';
import './App.css';

function App() {
  const [notes, setNotes] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [appliedFilters, setAppliedFilters] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [, setCurrentPage] = useState(1);
  const [selectedSubject, setSelectedSubject] = useState('');
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(() => {
    try {
      const role = localStorage.getItem('role');
      return role === '1';
    } catch (e) {
      return false;
    }
  });

  const fetchNotes = useCallback(async (filters = {}, page = 1) => {
    setLoading(true);
    setError(null);
    
    try {
      const params = {
        ...filters,
        page,
        limit: 10
      };
      
      const response = await notesApi.fetchNotes(params);
      
      if (response.status === 'success') {
        setNotes(response.notes);
        setPagination(response.pagination);
        setAppliedFilters(response.appliedFilters || {});
        setCurrentPage(page);
      } else {
        throw new Error('Failed to fetch notes');
      }
    } catch (err) {
      console.error('Error fetching notes:', err);
      setError(err.message || 'Failed to load notes. Please try again.');
      setNotes([]);
      setPagination(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    // If a subject is selected, include it in initial fetch
    const initialFilters = selectedSubject ? { subject: selectedSubject } : {};
    fetchNotes(initialFilters);
  }, [fetchNotes, selectedSubject]);

  // Filter handler removed — filters/search removed from top-right

  const handlePageChange = useCallback((page) => {
    fetchNotes(appliedFilters, page);
  }, [fetchNotes, appliedFilters]);

  return (
    <div className="braille-app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">🧭</div>
          <div className="brand-text">
            <div className="brand-sub">Smart notes</div>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Main navigation">
          <button className="nav-item" onClick={() => { setSelectedSubject(''); setAppliedFilters({}); fetchNotes({}, 1); }}>
            Explore
          </button>
          <div className="nav-separator" />
          {[
            'Mathematics','Physics','Chemistry','Biology','Programming','History','Geography','Literature','Music','General'
          ].map((s) => (
            <button
              key={s}
              className={`nav-item ${selectedSubject === s ? 'active' : ''}`}
              onClick={() => setSelectedSubject(s)}
            >
              {s}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          {isAdmin ? (
            <button
              className="auth-icon-btn"
              title="Logout"
              aria-label="Logout"
              onClick={() => {
                if (window.confirm('Logout?')) {
                  localStorage.removeItem('role');
                  setIsAdmin(false);
                }
              }}
            >
              ⎋ Logout
            </button>
          ) : (
            <button
              className="auth-icon-btn"
              title="Login"
              aria-label="Login"
              onClick={() => setIsAuthOpen(true)}
            >
              🔐 Login
            </button>
          )}
        </div>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <h1 className="topbar-title">Notes</h1>
          </div>
        </header>

        <main className="content">
          {!selectedSubject ? (
            <div className="subjects-grid hero-grid" aria-hidden={false}>
              {[
                { key: 'Mathematics', label: 'Math problems, equations', icon: '∑', color: '#FF6B6B' },
                { key: 'Physics', label: 'Concepts & laws', icon: '🔭', color: '#6BCB77' },
                { key: 'Chemistry', label: 'Reactions & compounds', icon: '⚗️', color: '#4D96FF' },
                { key: 'Biology', label: 'Living organisms', icon: '🧬', color: '#FFD93D' },
                { key: 'Programming', label: 'Code & algorithms', icon: '</>', color: '#9B5DE5' },
                { key: 'General', label: 'Miscellaneous', icon: '📌', color: '#9AA5FF' }
              ].map((s) => (
                <div
                  key={s.key}
                  className="subject-card hero"
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedSubject(s.key)}
                  onKeyDown={(e) => { if (e.key === 'Enter') setSelectedSubject(s.key); }}
                  style={{ borderColor: s.color }}
                >
                  <div className="subject-icon" style={{ backgroundColor: s.color }}>
                    <span className="subject-icon-symbol">{s.icon}</span>
                  </div>
                  <div className="subject-content">
                    <div className="subject-name">{s.key}</div>
                    <div className="subject-desc">{s.label}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="subject-page">
              <div className="subject-page-header">
                <button className="back-to-subjects" onClick={() => { setSelectedSubject(''); setAppliedFilters({}); fetchNotes({}, 1); }}>
                  ← Back
                </button>
                <h2 className="subject-title">{selectedSubject}</h2>
              </div>

              <NotesList 
                notes={notes}
                pagination={pagination}
                loading={loading}
                error={error}
                onPageChange={handlePageChange}
                appliedFilters={appliedFilters}
                isAdmin={isAdmin}
              />
            </div>
          )}
        </main>
      </div>

      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        onLogin={() => { setIsAdmin(true); setIsAuthOpen(false); }}
      />
    </div>
  );
}

export default App;
