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
  const [ttsStatus, setTtsStatus] = useState('');
  const audioRef = useRef(null);
  // react-speech-kit removed to avoid incompatible peer deps; using native + mespeak fallbacks

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
    if (!text || !('speechSynthesis' in window)) {
      console.warn('[TTS] Speech Synthesis not supported');
      setTtsStatus('unsupported');
      return;
    }

    try { window.speechSynthesis.cancel(); } catch (e) {}
    const plain = stripMarkdown(text);
    prepareWordsForHighlight(plain);

    // Do NOT wait here for voices to load — call speak immediately inside user gesture to avoid mobile blocking.

    const utter = new SpeechSynthesisUtterance(plain);
    const lc = (langCode && String(langCode)) || (detectedLanguage && String(detectedLanguage)) || activeLang || 'en-US';
    const lower = lc.toLowerCase();
    utter.lang = (lower.includes('hi') || lower.includes('hindi')) ? 'hi-IN' : 'en-US';
    utter.rate = 0.95;
    utter.pitch = 1.0;
    utter.volume = 1.0;

    const voices = window.speechSynthesis.getVoices() || [];
    const langPrefix = utter.lang.split('-')[0];
    const matched = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(langPrefix));
    if (matched) utter.voice = matched;

    utter.onstart = () => {
      setIsSpeaking(true);
      setIsPaused(false);
      setTtsStatus('playing');
    };
    utter.onend = () => {
      setIsSpeaking(false);
      setIsPaused(false);
      setTtsStatus('');
    };
    utter.onerror = (e) => {
      console.error('[TTS] utter error', e);
      setIsSpeaking(false);
      setIsPaused(false);
      setTtsStatus('error');
    };

    utteranceRef.current = utter;
    try {
      setTtsStatus('speaking');
      // clear any previous monitor
      if (ttsFallbackTimerRef.current) {
        clearTimeout(ttsFallbackTimerRef.current);
        ttsFallbackTimerRef.current = null;
      }
      // monitor native start
      let started = false;
      const onStart = () => { started = true; setTtsStatus('playing'); };
      utter.addEventListener && utter.addEventListener('start', onStart);
      try {
        window.speechSynthesis.speak(utter);
      } catch (err) {
        console.error('[TTS] speak threw', err);
        setTtsStatus('speak error: ' + (err && err.message ? err.message : String(err)));
      }

      // after 1200ms, if not started, attempt server fallback
      ttsFallbackTimerRef.current = setTimeout(async () => {
        ttsFallbackTimerRef.current = null;
        if (!started && !isSpeaking) {
          console.warn('[TTS] native did not start within timeout - trying server fallback');
          setTtsStatus('native did not start — trying server fallback');
          try {
            await fetchTtsFromServer(plain, utter.lang);
          } catch (err) {
            console.error('[TTS] server fallback failed', err);
            setTtsStatus('server fallback failed');
          }
        }
      }, 1200);

      // cleanup: remove onStart when utter ends or errors
      const cleanup = () => {
        try { utter.removeEventListener && utter.removeEventListener('start', onStart); } catch (e) {}
        if (ttsFallbackTimerRef.current) { clearTimeout(ttsFallbackTimerRef.current); ttsFallbackTimerRef.current = null; }
      };
      utter.onend = () => { cleanup(); setIsSpeaking(false); setIsPaused(false); setTtsStatus(''); };
      utter.onerror = (e) => { cleanup(); console.error('[TTS] utter error', e); setIsSpeaking(false); setIsPaused(false); setTtsStatus('error'); };
    } catch (e) {
      console.error('[TTS] speak failed', e);
      setTtsStatus('failed');
    }
  };

  // Server TTS fallback: expects POST /api/tts returning audio binary (e.g., mp3)
  const fetchTtsFromServer = async (text, lang) => {
    if (!text) throw new Error('no text');
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, lang })
      });
      if (!res.ok) throw new Error('TTS server error ' + res.status);
      const arrayBuffer = await res.arrayBuffer();
      const contentType = res.headers.get('Content-Type') || 'audio/mpeg';
      const blob = new Blob([arrayBuffer], { type: contentType });
      const url = URL.createObjectURL(blob);
      if (audioRef.current) {
        try { audioRef.current.pause(); } catch (e) {}
        URL.revokeObjectURL(audioRef.current.src);
      }
      audioRef.current = new Audio(url);
      audioRef.current.onended = () => {
        setIsSpeaking(false);
        setIsPaused(false);
        setTtsStatus('');
        try { URL.revokeObjectURL(url); } catch (e) {}
      };
      await audioRef.current.play();
      setIsSpeaking(true);
      setIsPaused(false);
      setTtsStatus('playing (server)');
    } catch (err) {
      console.error('[TTS] fetchTtsFromServer error', err);
      throw err;
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

  // Print the current note content (selected language) via browser print dialog (user can save as PDF)
  const escapeHtml = (str) => {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  const handlePrint = () => {
    try {
      const g = typeof note.generatedNotes === 'object' ? note.generatedNotes : { english: note.generatedNotes };
      const content = g[activeLang] || g[Object.keys(g)[0]] || '';
      // Build basic HTML for printing. For braille keep preformatted; for others render simple paragraphs.
      let bodyHtml = '';
      if ((activeLang || '').toLowerCase().includes('braille')) {
        bodyHtml = `<pre style="font-size:18px; line-height:1.4; white-space:pre-wrap;">${escapeHtml(content)}</pre>`;
      } else {
        // Convert simple Markdown to clean HTML for printing (remove hashes, format headers/lists/inline)
        const mdToHtml = (raw) => {
          const esc = escapeHtml(raw || '');
          const lines = esc.split(/\r?\n/);
          let out = '';
          let inUl = false;
          let inOl = false;
          let paraBuffer = [];

          const flushPara = () => {
            if (paraBuffer.length) {
              const txt = paraBuffer.join(' ').replace(/\s+/g, ' ');
              out += `<p style="margin:0 0 12px 0;">${txt}</p>`;
              paraBuffer = [];
            }
          };

          const inlineFmt = (s) => {
            return s
              .replace(/`([^`]+)`/g, '<code>$1</code>')
              .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
              .replace(/\*([^*]+)\*/g, '<em>$1</em>')
              .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
          };

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) {
              // blank line -> close lists and flush paragraph
              if (inUl) { out += '</ul>'; inUl = false; }
              if (inOl) { out += '</ol>'; inOl = false; }
              flushPara();
              continue;
            }

            // headers
            const hMatch = line.match(/^(#{1,6})\s*(.+)$/);
            if (hMatch) {
              if (inUl) { out += '</ul>'; inUl = false; }
              if (inOl) { out += '</ol>'; inOl = false; }
              flushPara();
              const level = Math.min(6, hMatch[1].length);
              out += `<h${level} style="margin:8px 0;">${inlineFmt(hMatch[2])}</h${level}>`;
              continue;
            }

            // ordered list
            const olMatch = line.match(/^\d+\.\s+(.+)$/);
            if (olMatch) {
              flushPara();
              if (inUl) { out += '</ul>'; inUl = false; }
              if (!inOl) { out += '<ol style="margin:0 0 12px 20px;">'; inOl = true; }
              out += `<li>${inlineFmt(olMatch[1])}</li>`;
              continue;
            }

            // unordered list
            const ulMatch = line.match(/^[-*+]\s+(.+)$/);
            if (ulMatch) {
              flushPara();
              if (inOl) { out += '</ol>'; inOl = false; }
              if (!inUl) { out += '<ul style="margin:0 0 12px 20px;">'; inUl = true; }
              out += `<li>${inlineFmt(ulMatch[1])}</li>`;
              continue;
            }

            // regular text -> accumulate in paragraph buffer
            paraBuffer.push(inlineFmt(line));
          }

          if (inUl) out += '</ul>';
          if (inOl) out += '</ol>';
          flushPara();
          return out || '<p></p>';
        };

        bodyHtml = mdToHtml(String(content));
      }

      const title = `${note && note.detectedSubject ? note.detectedSubject : 'Notes'} - ${activeLang || 'content'}`;
      // Use a hidden iframe to avoid popup blockers — write content there and invoke print
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      iframe.style.visibility = 'hidden';
      document.body.appendChild(iframe);
      const idoc = iframe.contentDocument || iframe.contentWindow.document;
      idoc.open();
      idoc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial; color:#0f1724; padding:24px; }
          h1 { margin:0 0 8px 0; font-size:20px }
          h2 { margin:0 0 16px 0; font-size:14px; color:#555 }
          pre { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, "Roboto Mono", monospace; }
        </style>
      </head><body>
        <h1>${escapeHtml(note && note.detectedSubject ? note.detectedSubject : 'Notes')}</h1>
        <h2>Language: ${escapeHtml(activeLang || 'unknown')}</h2>
        <div>${bodyHtml}</div>
      </body></html>`);
      idoc.close();

      const printAndCleanup = () => {
        try {
          const iw = iframe.contentWindow || iframe;
          iw.focus();
          if (typeof iw.print === 'function') iw.print();
        } catch (e) {
          console.error('Print failed', e);
        } finally {
          setTimeout(() => {
            try { document.body.removeChild(iframe); } catch (e) {}
          }, 500);
        }
      };

      // Some browsers require slight delay
      setTimeout(printAndCleanup, 300);
    } catch (err) {
      console.error('Print error', err);
      alert('Failed to open print dialog.');
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
          {/* inline TTS status for debugging on devices without console access */}
          {ttsStatus && (
            <div className="tts-status" style={{ marginRight: '12px', color: '#ffd', fontSize: '0.85rem', opacity: 0.9 }}>
              {ttsStatus}
            </div>
          )}
          {isAdmin && !editing && (
            <button className="modal-edit-button" onClick={() => setEditing(true)}>Edit</button>
          )}

          {/* Print button for current language content */}
          {note && (() => {
            const g = typeof note.generatedNotes === 'object' ? note.generatedNotes : { english: note.generatedNotes };
            const content = g[activeLang] || g[Object.keys(g)[0]] || '';
            if (!content) return null;
            return (
              <button className="modal-print-button" onClick={handlePrint}>Print</button>
            );
          })()}

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
