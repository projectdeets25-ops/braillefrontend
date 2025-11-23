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
  const mespeakRef = useRef(null);
  const audioCtxRef = useRef(null);
  const ttsFallbackTimerRef = useRef(null);
  const utterStartedRef = useRef(false);

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

  const speakText = async (text, langCode) => {
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
    const pickAndAssignVoice = () => {
      try {
        const voices = window.speechSynthesis.getVoices() || [];
        if (!voices.length) return false;
        const lp = (langCodeFinal || 'en-US').toLowerCase().split('-')[0];
        let v = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(lp));
        if (!v) v = voices.find((v) => v.lang && v.lang.toLowerCase().includes(lp));
        if (v) {
          utter.voice = v;
          return true;
        }
      } catch (e) {}
      return false;
    };

    // Attempt to assign a voice immediately if available.
    let voiceAssigned = false;
    try {
      voiceAssigned = pickAndAssignVoice();
      console.log('[TTS] pickAndAssignVoice ->', voiceAssigned ? 'voice assigned' : 'no voice');
    } catch (e) {
      console.warn('[TTS] pickAndAssignVoice error', e);
    }

    utter.onstart = () => {
      console.log('[TTS] utter onstart');
      utterStartedRef.current = true;
      if (ttsFallbackTimerRef.current) {
        clearTimeout(ttsFallbackTimerRef.current);
        ttsFallbackTimerRef.current = null;
      }
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
      console.log('[TTS] utter onend');
      setIsSpeaking(false);
      setIsPaused(false);
      setCurrentWordIndex(-1);
    };

    utter.onerror = (err) => {
      console.error('[TTS] utter onerror', err);
      setIsSpeaking(false);
      setIsPaused(false);
    };

    utteranceRef.current = utter;
    // Try speaking immediately (log voices available). If no native voices are present, fallback to mespeak (client-side WebAssembly/JS TTS).
    try {
      const allVoices = window.speechSynthesis.getVoices() || [];
      console.log('[TTS] speaking. voices available:', allVoices.length, 'lang:', langCodeFinal, 'voiceChosen:', utter.voice && utter.voice.name);

      if (!voiceAssigned && (!allVoices || allVoices.length === 0)) {
        // Fallback: use mespeak (client-side JS TTS) to synthesize without server.
        try {
          if (!mespeakRef.current) {
            // dynamic import so it's only loaded when needed
            const mespeakModule = await import('mespeak');
            // load default config
            try {
              const cfg = (await import('mespeak/src/mespeak_config.json')).default;
              mespeakModule.loadConfig(cfg);
            } catch (e) {
              console.warn('[TTS] mespeak config load failed', e);
            }
            mespeakRef.current = mespeakModule;
          }

          const ms = mespeakRef.current;
          // attempt to load a voice matching language prefix (en/hi). fall back to en if unavailable.
          const prefix = (langCodeFinal || 'en-US').split('-')[0].toLowerCase();
          let voiceLoaded = false;
          try {
            if (prefix === 'hi') {
              const v = (await import('mespeak/voices/hi/hi.json')).default;
              voiceLoaded = !!ms.loadVoice(v);
            } else {
              const v = (await import('mespeak/voices/en/en-us.json')).default;
              voiceLoaded = !!ms.loadVoice(v);
            }
          } catch (e) {
            console.warn('[TTS] mespeak voice load failed, trying en', e);
            try {
              const v = (await import('mespeak/voices/en/en-us.json')).default;
              voiceLoaded = !!ms.loadVoice(v);
            } catch (err) {
              console.warn('[TTS] mespeak fallback voice load failed', err);
            }
          }

          console.log('[TTS] mespeak speak (voiceLoaded=' + voiceLoaded + ')');
          const ok = ms.speak(plain);
          utteranceRef.current = { type: 'mespeak', module: ms };
          setIsSpeaking(true);
          setIsPaused(false);
          return;
        } catch (err) {
          console.error('[TTS] mespeak fallback failed', err);
          // fall through to native attempt
        }
      }

      // speak natively, but set a fallback timer: if onstart doesn't fire quickly, fallback to mespeak
      try {
        utterStartedRef.current = false;
        window.speechSynthesis.speak(utter);
        if (!utterStartedRef.current) {
          // wait up to 900ms for onstart; if not started, fallback
          ttsFallbackTimerRef.current = setTimeout(async () => {
            ttsFallbackTimerRef.current = null;
            if (!utterStartedRef.current) {
              console.warn('[TTS] native utter did not start, falling back to mespeak');
              // try mespeak fallback
              try {
                if (!mespeakRef.current) {
                  const mespeakModule = await import('mespeak');
                  try {
                    const cfg = (await import('mespeak/src/mespeak_config.json')).default;
                    mespeakModule.loadConfig(cfg);
                  } catch (e) { console.warn('[TTS] mespeak config load failed', e); }
                  mespeakRef.current = mespeakModule;
                }
                const ms = mespeakRef.current;
                try {
                  const v = (await import('mespeak/voices/en/en-us.json')).default;
                  ms.loadVoice(v);
                } catch (e) { /* ignore */ }
                ms.speak(plain);
                utteranceRef.current = { type: 'mespeak', module: ms };
                setIsSpeaking(true);
                setIsPaused(false);
              } catch (err) {
                console.error('[TTS] mespeak fallback after no-start failed', err);
              }
            }
          }, 900);
        }
      } catch (e) {
        console.error('[TTS] initial speak failed', e);
        try { window.speechSynthesis.speak(utter); } catch (err) { console.error('[TTS] fallback speak failed', err); }
      }
    } catch (e) {
      console.error('[TTS] initial speak failed', e);
      try { window.speechSynthesis.speak(utter); } catch (err) { console.error('[TTS] fallback speak failed', err); }
    }
  };

  // Ensure AudioContext unlocked on mobile (user gesture) to avoid audio being blocked
  const ensureAudioUnlocked = () => {
    try {
      if (!window) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtxRef.current) audioCtxRef.current = new AC();
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        ctx.resume().then(() => console.log('[TTS] AudioContext resumed')).catch(() => {});
      }
      // play a tiny silent buffer to unlock
      try {
        const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(ctx.destination);
        src.start(0);
        setTimeout(() => { try { src.disconnect(); } catch (e) {} }, 50);
      } catch (e) {}
    } catch (e) {
      console.warn('[TTS] ensureAudioUnlocked failed', e);
    }
  };

  const handlePlayPause = () => {
    if (!note) return;
    const g = typeof note.generatedNotes === 'object' ? note.generatedNotes : { english: note.generatedNotes };
    const content = g[activeLang] || g[Object.keys(g)[0]] || '';

    // language code choice
    const langCode = activeLang === 'hindi' ? 'hi-IN' : 'en-US';
    console.log('[TTS] play/pause clicked', { activeLang, isSpeaking, isPaused, detectedLanguage });
    // unlock audio context on user gesture to avoid mobile blocking
    ensureAudioUnlocked();

    // Use actual speechSynthesis state for robust pause/resume
    try {
      const synth = window.speechSynthesis;
      if (synth.speaking && !synth.paused) {
        console.log('[TTS] pausing synth');
        synth.pause();
        setIsPaused(true);
        setIsSpeaking(true);
        return;
      }
      if (synth.speaking && synth.paused) {
        console.log('[TTS] resuming synth');
        synth.resume();
        setIsPaused(false);
        setIsSpeaking(true);
        return;
      }
    } catch (e) {
      console.warn('[TTS] synth state check failed', e);
    }

    // Not currently speaking -> start speaking
    if (!supportedLang(activeLang) && !supportedLang(detectedLanguage)) {
      console.log('[TTS] language unsupported for TTS', activeLang, detectedLanguage);
      return;
    }
    try {
      console.log('[TTS] invoking speakText');
      speakText(content, langCode);
    } catch (err) {
      console.error('[TTS] speakText threw', err);
    }
  };

  const handleStop = () => {
    try {
      // stop mespeak if it's playing
      if (utteranceRef.current && utteranceRef.current.type === 'mespeak' && mespeakRef.current) {
        try { mespeakRef.current.stop && mespeakRef.current.stop(); } catch (e) {}
        utteranceRef.current = null;
        setIsSpeaking(false);
        setIsPaused(false);
        setCurrentWordIndex(-1);
        return;
      }
    } catch (e) {}
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
