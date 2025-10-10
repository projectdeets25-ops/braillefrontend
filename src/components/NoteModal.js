import React, { useState, useEffect } from 'react';
import notesApi from '../services/notesApi';
import ReactMarkdown from 'react-markdown';
import './NoteModal.css';

const NoteModal = ({ note, isOpen, onClose, formatDate, isAdmin }) => {
  const [editing, setEditing] = useState(false);
  // Store generatedNotes as an object so admin can edit multiple languages
  const [generatedNotesValue, setGeneratedNotesValue] = useState(note ? note.generatedNotes : {});

  // Local form fields for common properties
  const [detectedLanguage, setDetectedLanguage] = useState(note ? note.detectedLanguage || '' : '');
  const [detectedSubject, setDetectedSubject] = useState(note ? note.detectedSubject || '' : '');
  const [originalContent, setOriginalContent] = useState(note ? note.originalContent || '' : '');
  // UI: active language tab for viewing/editing
  const [activeLang, setActiveLang] = useState('english');

  // keep local state in sync when note prop changes
  useEffect(() => {
    setGeneratedNotesValue(note ? note.generatedNotes || {} : {});
    setDetectedLanguage(note ? note.detectedLanguage || '' : '');
    setDetectedSubject(note ? note.detectedSubject || '' : '');
    setOriginalContent(note ? note.originalContent || '' : '');
  }, [note]);

  if (!isOpen || !note) return null;

  const getInputTypeIcon = (inputType) => {
    switch (inputType) {
      case 'text': return '📝';
      case 'audio': return '🎵';
      default: return '📄';
    }
  };

  const getInputTypeLabel = (inputType) => {
    switch (inputType) {
      case 'text': return 'Text Note';
      case 'audio': return 'Audio Note';
      default: return 'Unknown Type';
    }
  };

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div 
      className="modal-backdrop" 
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div className="modal-container">
        <div className="modal-header">
          <div className="modal-title-section">
            <div className="modal-type-badge">
              <span className="modal-type-icon">{getInputTypeIcon(note.inputType)}</span>
              <span className="modal-type-label">{getInputTypeLabel(note.inputType)}</span>
            </div>
            <div className="modal-dates">
              <div className="modal-date">
                <strong>Created:</strong> {formatDate(note.createdAt)}
              </div>
              {note.updatedAt && note.updatedAt !== note.createdAt && (
                <div className="modal-date">
                  <strong>Updated:</strong> {formatDate(note.updatedAt)}
                </div>
              )}
            </div>
          </div>
          <button 
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        <div className="modal-content">
          <div className="modal-note-content">
            {!editing && (
              // Tabs to switch between languages when viewing
              <div className="generated-notes-view">
                <div className="lang-tabs">
                  <button className={`lang-tab ${activeLang === 'english' ? 'active' : ''}`} onClick={() => setActiveLang('english')}>English</button>
                  <button className={`lang-tab ${activeLang === 'hindi' ? 'active' : ''}`} onClick={() => setActiveLang('hindi')}>Hindi</button>
                  <button className={`lang-tab ${activeLang === 'braille' ? 'active' : ''}`} onClick={() => setActiveLang('braille')}>Braille</button>
                </div>

                <div className="lang-content">
                  {(() => {
                    const g = typeof note.generatedNotes === 'object' ? note.generatedNotes : { english: note.generatedNotes };
                    const content = g[activeLang] || g[Object.keys(g)[0]] || '';
                    return <ReactMarkdown>{content}</ReactMarkdown>;
                  })()}
                </div>
              </div>
            )}

            {editing && (
              <div className="note-edit-form">
                <div className="edit-lang-tabs">
                  <button className={`lang-tab ${activeLang === 'english' ? 'active' : ''}`} onClick={() => setActiveLang('english')}>English</button>
                  <button className={`lang-tab ${activeLang === 'hindi' ? 'active' : ''}`} onClick={() => setActiveLang('hindi')}>Hindi</button>
                  <button className={`lang-tab ${activeLang === 'braille' ? 'active' : ''}`} onClick={() => setActiveLang('braille')}>Braille</button>
                </div>

                <div className="edit-lang-content">
                  {activeLang === 'english' && (
                    <div>
                      <label>English</label>
                      <textarea
                        value={generatedNotesValue.english || ''}
                        onChange={(e) => setGeneratedNotesValue({ ...generatedNotesValue, english: e.target.value })}
                      />
                    </div>
                  )}

                  {activeLang === 'hindi' && (
                    <div>
                      <label>Hindi</label>
                      <textarea
                        value={generatedNotesValue.hindi || ''}
                        onChange={(e) => setGeneratedNotesValue({ ...generatedNotesValue, hindi: e.target.value })}
                      />
                    </div>
                  )}

                  {activeLang === 'braille' && (
                    <div>
                      <label>Braille</label>
                      <textarea
                        value={generatedNotesValue.braille || ''}
                        onChange={(e) => setGeneratedNotesValue({ ...generatedNotesValue, braille: e.target.value })}
                      />
                    </div>
                  )}
                </div>

                <label>Detected Language</label>
                <input value={detectedLanguage} onChange={(e) => setDetectedLanguage(e.target.value)} />

                <label>Detected Subject</label>
                <input value={detectedSubject} onChange={(e) => setDetectedSubject(e.target.value)} />

                <label>Original Content</label>
                <textarea value={originalContent} onChange={(e) => setOriginalContent(e.target.value)} />
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          {isAdmin && !editing && (
            <button className="modal-edit-button" onClick={() => setEditing(true)}>Edit</button>
          )}

          {isAdmin && editing && (
            <button
              className="modal-save-button"
              onClick={async () => {
                try {
                  // Build payload following API expectation
                  const payload = {
                    generatedNotes: generatedNotesValue,
                    detectedLanguage,
                    detectedSubject,
                    originalContent
                  };

                  const res = await notesApi.updateNote(note._id, payload);

                  if (res && res.status === 'success') {
                    // Ideally update in-place; reload for simplicity
                    window.location.reload();
                  } else {
                    console.error('Failed to save note', res);
                  }
                } catch (err) {
                  console.error('Failed to save note', err);
                }
              }}
            >
              Save
            </button>
          )}

          {isAdmin && (
            <button
              className="modal-delete-button"
              onClick={async () => {
                if (!window.confirm('Delete this note?')) return;
                try {
                  await notesApi.deleteNote(note._id);
                  // refresh list
                  window.location.reload();
                } catch (err) {
                  console.error('Failed to delete note', err);
                }
              }}
            >
              Delete
            </button>
          )}

          <button 
            className="modal-close-button"
            onClick={() => { setEditing(false); onClose(); }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default NoteModal;
