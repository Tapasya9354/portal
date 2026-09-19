import { useEffect, useState, useRef } from 'react';
import { useAuth, UserButton } from '@clerk/clerk-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './KtChatPage.css';

async function fetchJson(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Request to ${url} failed (${res.status}).`);
  return res.json();
}

const SUGGESTIONS = [
  { label: '🏛️ Architecture Overview', query: 'Can you give me an overview of this repository\'s architecture and main components?' },
  { label: '🔐 Security & Auth', query: 'Where is authentication and GitHub token security handled in the backend?' },
  { label: '📋 AI Review Rules', query: 'What architectural rules and coding standards does the AI PR Reviewer enforce?' },
  { label: '⚡ PR Review Lifecycle', query: 'How does the PR review pipeline trigger and process a new pull request?' },
  { label: '🚀 Developer Onboarding', query: 'Where should a new engineer start if they want to contribute to this codebase?' },
];

export default function KtChatPage({ onBack }) {
  const { getToken } = useAuth();
  
  const [repos, setRepos] = useState([]);
  const [selectedRepoId, setSelectedRepoId] = useState(null);
  
  const [sessions, setSessions] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);

  const messagesEndRef = useRef(null);

  // Load Repos
  useEffect(() => {
    let cancelled = false;
    async function loadRepos() {
      try {
        const token = await getToken();
        const repoList = await fetchJson('/api/repositories', token);
        if (!cancelled) setRepos(repoList);
      } catch (e) {
        console.error(e);
      }
    }
    loadRepos();
    return () => { cancelled = true; };
  }, [getToken]);

  // Load Sessions when Repo changes
  useEffect(() => {
    if (!selectedRepoId) {
      setSessions([]);
      setSelectedSessionId(null);
      return;
    }
    let cancelled = false;
    async function loadSessions() {
      try {
        const token = await getToken();
        const list = await fetchJson(`/api/kt/chat/sessions?repository_id=${selectedRepoId}`, token);
        if (!cancelled) {
          setSessions(list);
          if (list.length > 0) {
            setSelectedSessionId(list[0].session_id);
          } else {
            setSelectedSessionId(null);
          }
        }
      } catch (e) {
        console.error(e);
      }
    }
    loadSessions();
    return () => { cancelled = true; };
  }, [selectedRepoId, getToken]);

  // Load & Poll Messages
  useEffect(() => {
    if (!selectedSessionId) {
      setMessages([]);
      return;
    }
    
    let cancelled = false;
    let timer = null;

    async function loadMessages() {
      try {
        const token = await getToken();
        const list = await fetchJson(`/api/kt/chat/messages?session_id=${selectedSessionId}`, token);
        if (!cancelled) {
          setMessages(list);
          const isProcessing = list.some(m => m.status === 'processing');
          if (isProcessing) {
            timer = setTimeout(loadMessages, 3000);
          }
        }
      } catch (e) {
        console.error(e);
      }
    }
    
    loadMessages();
    
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [selectedSessionId, getToken]);

  // Auto-scroll to bottom of chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e, customQuery = null) => {
    if (e) e.preventDefault();
    const queryToSend = customQuery !== null ? customQuery : input;
    if (!queryToSend.trim() || !selectedRepoId) return;

    const token = await getToken();
    const sessionId = selectedSessionId || 'session-' + Math.random().toString(36).substr(2, 9);
    const query = queryToSend;
    
    setInput('');
    setIsSending(true);

    try {
      // Optimistic UI update
      setMessages(prev => [
        ...prev, 
        { id: 'temp-' + Date.now(), role: 'user', content: query, status: 'completed' },
        { id: 'temp-' + Date.now() + 1, role: 'assistant', content: '', status: 'processing' }
      ]);
      setSelectedSessionId(sessionId);

      const res = await fetch('/api/kt/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          repository_id: selectedRepoId,
          session_id: sessionId,
          query: query
        })
      });

      if (!res.ok) {
        let detail = `Failed to send message (${res.status}).`;
        try {
          const body = await res.json();
          if (body?.detail) detail = body.detail;
        } catch {
        }
        throw new Error(detail);
      }
      
      // Immediately reload messages from backend for instant rendering
      const updatedList = await fetchJson(`/api/kt/chat/messages?session_id=${sessionId}`, token);
      setMessages(updatedList);

      // If it's a new session, refresh session list
      if (!selectedSessionId) {
        const list = await fetchJson(`/api/kt/chat/sessions?repository_id=${selectedRepoId}`, token);
        setSessions(list);
      }
    } catch (err) {
      console.error(err);
      alert(err.message);
      setMessages(prev => prev.map(m => (
        m.role === 'assistant' && m.status === 'processing'
          ? { ...m, status: 'error', content: err.message }
          : m
      )));
    } finally {
      setIsSending(false);
    }
  };

  const handleNewChat = () => {
    setSelectedSessionId(null);
    setMessages([]);
  };

  return (
    <div className="kt-layout">
      <header className="kt-header">
        <div className="kt-header-left">
          <button className="secondary-button" onClick={onBack}>← Back to Dashboard</button>
          <h1>Knowledge Transfer Chat</h1>
        </div>
        <UserButton afterSignOutUrl="/" />
      </header>

      <div className="kt-content">
        <aside className="kt-sidebar">
          <h3>Repositories</h3>
          <ul className="kt-repo-list">
            {repos.map(r => (
              <li 
                key={r.id} 
                className={r.id === selectedRepoId ? 'active' : ''}
                onClick={() => setSelectedRepoId(r.id)}
              >
                {r.full_name}
              </li>
            ))}
          </ul>
          
          {selectedRepoId && (
            <>
              <h3 className="mt-6">Recent Chats</h3>
              <button className="secondary-button w-full mb-4" onClick={handleNewChat}>+ New Chat</button>
              <ul className="kt-session-list">
                {sessions.map(s => (
                  <li 
                    key={s.session_id} 
                    className={s.session_id === selectedSessionId ? 'active' : ''}
                    onClick={() => setSelectedSessionId(s.session_id)}
                  >
                    {s.first_query?.substring(0, 40) || 'New Chat'}...
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>

        <main className="kt-main">
          {!selectedRepoId ? (
            <div className="kt-empty-state">
              <h2>Select a repository to start chatting</h2>
              <p>Ask architecture, codebase, or PR related questions.</p>
            </div>
          ) : (
            <div className="kt-chat-container">
              <div className="kt-messages">
                {messages.length === 0 && (
                  <div className="kt-empty-state">
                    <h2>How can I help you understand this repo?</h2>
                    <p>Select a question below or type your own:</p>
                    <div className="kt-empty-suggestions">
                      {SUGGESTIONS.map((s, idx) => (
                        <button
                          key={idx}
                          type="button"
                          className="kt-empty-suggestion-card"
                          onClick={() => handleSend(null, s.query)}
                          disabled={isSending}
                        >
                          <span className="kt-suggestion-title">{s.label}</span>
                          <span className="kt-suggestion-preview">{s.query}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {messages.map((m, i) => (
                  <div key={m.id || i} className={`kt-message ${m.role}`}>
                    <div className="kt-message-bubble">
                      {m.role === 'assistant' ? (
                        m.status === 'processing' && !m.content ? (
                          <div className="kt-loading">
                            <span className="dot"></span><span className="dot"></span><span className="dot"></span>
                          </div>
                        ) : (
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                        )
                      ) : (
                        <p>{m.content}</p>
                      )}
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              <div className="kt-suggestions-bar">
                {SUGGESTIONS.map((s, idx) => (
                  <button 
                    key={idx} 
                    type="button" 
                    className="kt-suggestion-chip"
                    onClick={() => handleSend(null, s.query)}
                    disabled={isSending || messages.some(m => m.status === 'processing')}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              <form className="kt-input-form" onSubmit={handleSend}>
                <input 
                  type="text" 
                  value={input} 
                  onChange={e => setInput(e.target.value)} 
                  placeholder="Ask a question about this repository..." 
                  disabled={isSending || messages.some(m => m.status === 'processing')}
                />
                <button 
                  type="submit" 
                  className="primary-button" 
                  disabled={!input.trim() || isSending || messages.some(m => m.status === 'processing')}
                >
                  Send
                </button>
              </form>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

