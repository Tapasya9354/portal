import { useState } from 'react'
import './App.css'

function App() {
  const [form, setForm] = useState({ repositoryUrl: '', username: '', appPassword: '' })
  const [status, setStatus] = useState({ type: 'idle', message: '' })

  const updateField = (event) => {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
  }

  const submitRegistration = async (event) => {
    event.preventDefault()
    setStatus({ type: 'loading', message: 'Checking repository access...' })
    try {
      const response = await fetch('/api/repositories', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repository_url: form.repositoryUrl, github_username: form.username, github_app_password: form.appPassword }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.detail || 'Registration failed.')
      setStatus({ type: 'success', message: 'Repository verified and registered.' })
      setForm({ repositoryUrl: '', username: '', appPassword: '' })
    } catch (error) {
      setStatus({ type: 'error', message: error.message || 'Could not register repository.' })
    }
  }

  return (
    <main className="portal-shell">
      <header className="topbar"><div className="brand"><span className="brand-mark">PR</span><span>PR Reviewer</span></div><span className="secure-label"><span className="status-dot" /> Secure workspace</span></header>
      <section className="content-grid">
        <div className="intro"><p className="eyebrow">Repository onboarding</p><h1>Put every pull request through a sharper review.</h1><p className="intro-copy">Connect a GitHub repository and let your review agents work from a verified source of truth.</p><div className="flow-note"><span className="flow-number">01</span><div><strong>Register once</strong><p>We verify your repository access before anything is saved.</p></div></div><div className="flow-note"><span className="flow-number">02</span><div><strong>Stay connected</strong><p>Your verified repository is ready for review workflows.</p></div></div></div>
        <form className="registration-card" onSubmit={submitRegistration}><div className="card-heading"><div><p className="eyebrow">New connection</p><h2>Register a repository</h2></div><span className="step-badge">STEP 1 / 1</span></div><label>GitHub repository URL<span className="required">*</span><input name="repositoryUrl" value={form.repositoryUrl} onChange={updateField} placeholder="https://github.com/your-org/your-repo" required /></label><label>GitHub username<span className="required">*</span><input name="username" value={form.username} onChange={updateField} placeholder="your-github-username" autoComplete="username" required /></label><label>GitHub App password<span className="required">*</span><input name="appPassword" type="password" value={form.appPassword} onChange={updateField} placeholder="Your GitHub App password" autoComplete="off" required /><small>Used to verify repository access. Only a salted hash is stored.</small></label>{status.type !== 'idle' && <div className={`form-status ${status.type}`}>{status.type === 'loading' ? '◌' : status.type === 'success' ? '✓' : '!'} {status.message}</div>}<button className="submit-button" disabled={status.type === 'loading'} type="submit">{status.type === 'loading' ? 'Verifying...' : 'Verify & register'} <span>→</span></button><p className="privacy-note">Your App password is transmitted over HTTPS and never stored in plain text.</p></form>
      </section>
      <footer><span>PR REVIEWER / CONTROL PLANE</span><span>Built for teams who review with intent.</span></footer>
    </main>
  )
}

export default App
