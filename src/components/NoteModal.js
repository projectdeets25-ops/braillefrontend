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
  
  // Set active language to a sensible available language when note changes
  useEffect(() => {
    if (!note) return;
    const g = typeof note.generatedNotes === 'object' ? note.generatedNotes : { english: note.generatedNotes };
    const keys = Object.keys(g);
    const preferred = keys.includes('english') ? 'english' : keys.includes('hindi') ? 'hindi' : keys.includes('braille') ? 'braille' : (keys[0] || 'english');
    setActiveLang(preferred);
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

  // languages available in this note (dynamic)
  const availableLangs = (() => {
    const g = typeof note.generatedNotes === 'object' ? note.generatedNotes : { english: note.generatedNotes };
    const keys = Object.keys(g || {});
    return keys.length ? keys : ['english'];
  })();

  // Note: we intentionally removed visual input-type icons/labels to match the new UI.

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

    // Determine language code to use (prefer explicit langCode, then detectedLanguage, then activeLang)
    const lc = (langCode && String(langCode)) || (detectedLanguage && String(detectedLanguage)) || activeLang || 'en-US';
    let langCodeFinal = 'en-US';
    try {
      const lower = lc.toLowerCase();
      if (lower.includes('hi') || lower.includes('hindi')) langCodeFinal = 'hi-IN';
      else if (lower.includes('en')) langCodeFinal = 'en-US';
      else langCodeFinal = lc;
    } catch (e) {
      langCodeFinal = 'en-US';
    }

    utter.lang = langCodeFinal;

    // Try to pick a matching voice for the language to improve reliability (some browsers need voice selection)
    try {
      const pickVoice = (langPrefix) => {
        const voices = window.speechSynthesis.getVoices() || [];
        if (!voices.length) return null;
        const lp = langPrefix.toLowerCase();
        // prefer exact prefix match, then contains
        let v = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(lp));
        if (!v) v = voices.find((v) => v.lang && v.lang.toLowerCase().includes(lp));
        return v || null;
      };

      const prefix = (langCodeFinal || 'en-US').split('-')[0];
      const chosen = pickVoice(prefix);
      if (chosen) utter.voice = chosen;
    } catch (e) {
      // ignore voice selection errors
    }

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
            <div className="modal-meta">
              <div className="modal-subject">{detectedSubject || 'General'}</div>
              <div className="modal-date"><strong>Created:</strong> {formatDate(note.createdAt)}</div>
              <div className="modal-lang">Language: {detectedLanguage || 'Unknown'}</div>
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
          <div className="modal-grid">
            <aside className="modal-side">
              <div className="side-section">
                <div className="side-label">Subject</div>
                <div className="side-value">{detectedSubject || 'General'}</div>
              </div>
              <div className="side-section">
                <div className="side-label">Language</div>
                <div className="side-value">{detectedLanguage || 'Unknown'}</div>
              </div>
              <div className="side-section">
                <div className="side-label">Original</div>
                <div className="side-value small">{originalContent ? (originalContent.substring(0, 140) + (originalContent.length > 140 ? '...' : '')) : '—'}</div>
              </div>

              {/* Compact TTS controls on the side */}
              {/* <div className="side-tts">
                {note && (() => {
                  const g = typeof note.generatedNotes === 'object' ? note.generatedNotes : { english: note.generatedNotes };
                  const content = g[activeLang] || g[Object.keys(g)[0]] || '';
                  const langSupported = supportedLang(activeLang) || supportedLang(detectedLanguage);
                  if (!content || !langSupported) return null;
                  return (
                    <>
                      <button className="modal-play-button" onClick={handlePlayPause}>
                        {isSpeaking ? (isPaused ? 'Resume' : 'Pause') : 'Play'}
                      </button>
                      <button className="modal-stop-button" onClick={handleStop}>Stop</button>
                    </>
                  );
                })()}
              </div> */}
            </aside>

            <section className="modal-main">
              {!editing && (
                <>
                  <div className="lang-selector" role="tablist" aria-label="Select language">
                    {availableLangs.map((lang) => (
                      <button
                        key={lang}
                        role="tab"
                        aria-selected={activeLang === lang}
                        className={`lang-btn ${activeLang === lang ? 'active' : ''}`}
                        onClick={() => setActiveLang(lang)}
                      >
                        {lang.charAt(0).toUpperCase() + lang.slice(1)}
                      </button>
                    ))}
                  </div>

                  <div className="rendered-markdown" data-lang={activeLang}>
                    {(() => {
                      const g = typeof note.generatedNotes === 'object' ? note.generatedNotes : { english: note.generatedNotes };
                      const content = g[activeLang] || g[Object.keys(g)[0]] || '';
                      return (
                        <ReactMarkdown>
                          {content || '*No content*'}
                        </ReactMarkdown>
                      );
                    })()}
                  </div>
                </>
              )}

              {editing && (
                <div className="note-edit-form">
                  {/* dynamic edit fields for each available generated language */}
                  {Object.keys(generatedNotesValue || {}).length > 0 ? (
                    Object.keys(generatedNotesValue).map((lng) => (
                      <div key={lng}>
                        <label>{lng.charAt(0).toUpperCase() + lng.slice(1)}</label>
                        <textarea
                          value={generatedNotesValue[lng] || ''}
                          onChange={(e) => setGeneratedNotesValue({ ...generatedNotesValue, [lng]: e.target.value })}
                        />
                      </div>
                    ))
                  ) : (
                    <div>
                      <div>No generated languages found.</div>
                      <button onClick={() => setGeneratedNotesValue({ english: '' })}>Add English</button>
                    </div>
                  )}

                  <label>Detected Language</label>
                  <input value={detectedLanguage} onChange={(e) => setDetectedLanguage(e.target.value)} />

                  <label>Detected Subject</label>
                  <input value={detectedSubject} onChange={(e) => setDetectedSubject(e.target.value)} />

                  <label>Original Content</label>
                  <textarea value={originalContent} onChange={(e) => setOriginalContent(e.target.value)} />
                </div>
              )}
            </section>
          </div>
        </div>

        <div className="modal-footer">
          {/* TTS controls in footer (placed left of other buttons) */}
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
