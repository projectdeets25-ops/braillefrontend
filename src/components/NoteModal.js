import React, { useState, useEffect, useRef } from 'react';
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

  // If user switches language tab while speaking, stop/reset speech
  useEffect(() => {
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      setIsPaused(false);
      setCurrentWordIndex(-1);
    }
  }, [activeLang]);

  // Text-to-speech state and refs
  const utteranceRef = useRef(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentWordIndex, setCurrentWordIndex] = useState(-1);
  const [words, setWords] = useState([]);
  const [wordStartIndices, setWordStartIndices] = useState([]);

  // Helper: strip markdown to plain text for TTS and highlighting
  const stripMarkdown = (text) => {
    if (!text || typeof text !== 'string') return '';
    return text
      .replace(/```[\s\S]*?```/g, '')
      .replace(/#{1,6}\s+/g, '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/`(.*?)`/g, '$1')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+\.\s+/gm, '')
      .replace(/\n+/g, ' ')
      .trim();
  };

  // Prepare words and their start indices for boundary mapping
  const prepareWordsForHighlight = (plainText) => {
    const w = plainText.match(/\S+/g) || [];
    const starts = [];
    let searchIndex = 0;
    for (let i = 0; i < w.length; i++) {
      const word = w[i];
      const idx = plainText.indexOf(word, searchIndex);
      starts.push(idx === -1 ? 0 : idx);
      searchIndex = (idx === -1 ? searchIndex : idx + word.length);
    }
    setWords(w);
    setWordStartIndices(starts);
  };

  // Cleanup any running speech when modal closes or component unmounts
  useEffect(() => {
    return () => {
      try {
        window.speechSynthesis.cancel();
      } catch (e) {}
      utteranceRef.current = null;
    };
  }, []);

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

  // TTS controls
  const supportedLang = (lang) => {
    if (!lang) return false;
    const l = lang.toLowerCase();
    return l.includes('english') || l.includes('en') || l.includes('hindi') || l.includes('hi');
  };

  const speakText = (text, langCode) => {
    if (!text || !('speechSynthesis' in window)) return;

    window.speechSynthesis.cancel();
    const plain = stripMarkdown(text);
    prepareWordsForHighlight(plain);

    const utter = new SpeechSynthesisUtterance(plain);
    utter.lang = langCode || (detectedLanguage ? detectedLanguage : 'en-US');
    utter.onstart = () => {
      setIsSpeaking(true);
      setIsPaused(false);
      setCurrentWordIndex(-1);
    };

    // Fallback: use boundary event if available, otherwise approximate via word timings
    utter.onboundary = (e) => {
      if (e.name === 'word' || e.name === 'word' /* some browsers */) {
        const charIndex = e.charIndex || 0;
        // find nearest word index
        let wi = 0;
        for (let i = 0; i < wordStartIndices.length; i++) {
          if (wordStartIndices[i] <= charIndex) wi = i;
          else break;
        }
        setCurrentWordIndex(wi);
      }
    };

    utter.onend = () => {
      setIsSpeaking(false);
      setIsPaused(false);
      setCurrentWordIndex(-1);
    };

    utter.onerror = () => {
      setIsSpeaking(false);
      setIsPaused(false);
    };

    utteranceRef.current = utter;
    window.speechSynthesis.speak(utter);
  };

  const handlePlayPause = () => {
    if (!note) return;
    const g = typeof note.generatedNotes === 'object' ? note.generatedNotes : { english: note.generatedNotes };
    const content = g[activeLang] || g[Object.keys(g)[0]] || '';

    // language code choice
    const langCode = activeLang === 'hindi' ? 'hi-IN' : 'en-US';

    if (isSpeaking && !isPaused) {
      // pause
      window.speechSynthesis.pause();
      setIsPaused(true);
    } else if (isSpeaking && isPaused) {
      // resume
      window.speechSynthesis.resume();
      setIsPaused(false);
    } else {
      // start speaking
      if (!supportedLang(activeLang) && !supportedLang(detectedLanguage)) return;
      speakText(content, langCode);
    }
  };

  const handleStop = () => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    setIsPaused(false);
    setCurrentWordIndex(-1);
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
                    // Render markdown but also wrap for highlighting
                    const plain = stripMarkdown(content);
                    // Split into spans so we can highlight current word
                    const wordsForRender = plain.match(/\S+/g) || [];
                    let charIndex = 0;
                    return (
                      <div className="tts-text" aria-live="polite">
                        {wordsForRender.map((w, i) => {
                          const start = plain.indexOf(w, charIndex);
                          charIndex = start + w.length;
                          const isActive = i === currentWordIndex;
                          return (
                            <span
                              key={i}
                              data-word-index={i}
                              className={`tts-word ${isActive ? 'tts-word-active' : ''}`}
                              style={{ marginRight: '4px' }}
                            >
                              {w}
                            </span>
                          );
                        })}
                      </div>
                    );
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
          {/* TTS controls: only show for English/Hindi */}
          {note && ( () => {
            const g = typeof note.generatedNotes === 'object' ? note.generatedNotes : { english: note.generatedNotes };
            const content = g[activeLang] || g[Object.keys(g)[0]] || '';
            const langSupported = supportedLang(activeLang) || supportedLang(detectedLanguage);
            if (!content || !langSupported) return null;
            return (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginRight: 'auto' }}>
                <button className="modal-play-button" onClick={handlePlayPause}>
                  {isSpeaking ? (isPaused ? 'Resume' : 'Pause') : 'Play'}
                </button>
                <button className="modal-stop-button" onClick={handleStop}>Stop</button>
              </div>
            );
          })()}
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
