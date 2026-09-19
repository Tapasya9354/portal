import { useState } from 'react';
import { SignedIn, SignedOut, SignIn } from '@clerk/clerk-react';
import Dashboard from './components/Dashboard.jsx';
import KtChatPage from './components/KtChatPage.jsx';
import RegistrationPage from './components/RegistrationPage.jsx';
import './App.css';

export default function App() {
  const [view, setView] = useState('registration');

  return (
    <>
      <SignedOut>
        <div className="auth-shell">
          <SignIn routing="virtual" />
        </div>
      </SignedOut>
      <SignedIn>
        {view === 'registration' && <RegistrationPage onContinue={() => setView('dashboard')} />}
        {view === 'dashboard' && <Dashboard onManageRepos={() => setView('registration')} onOpenChat={() => setView('kt-chat')} />}
        {view === 'kt-chat' && <KtChatPage onBack={() => setView('dashboard')} />} />
        )}
        {view === 'kt-chat' && <KtChatPage onBack={() => setView('dashboard')} />}
      </SignedIn>
    </>
  );
}
