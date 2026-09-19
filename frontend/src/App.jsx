import { useState } from 'react';
import { SignedIn, SignedOut, SignIn } from '@clerk/clerk-react';
import Dashboard from './components/Dashboard.jsx';
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
        {view === 'registration' ? (
          <RegistrationPage onContinue={() => setView('dashboard')} />
        ) : (
          <Dashboard onManageRepos={() => setView('registration')} />
        )}
      </SignedIn>
    </>
  );
}
