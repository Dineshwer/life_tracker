import { FormEvent, useState } from 'react';
import { supabase } from './lib/supabase';
import { Button, Field } from './components/ui';
import Sapling from './components/Sapling';
import './styles/auth.css';

export default function Auth() {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'err' | 'ok'; text: string } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true); setMsg(null);
    if (mode === 'in') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMsg({ kind: 'err', text: error.message });
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) setMsg({ kind: 'err', text: error.message });
      else if (!data.session) setMsg({ kind: 'ok', text: 'Account created. Check your email for a confirmation link, then sign in.' });
    }
    setBusy(false);
  };

  return (
    <div className="auth">
      <div className="auth-col">
        <div className="auth-tree"><Sapling levels={{ body: 3, mind: 3, skill: 3, discipline: 3 }} overall={4} size={200} /></div>
        <div className="auth-brand display">Ledger<span>.</span></div>
        <p className="auth-line">A quiet place to run your life.</p>
        <div className="card auth-card">
        <form onSubmit={submit}>
          <Field label="Email"><input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Password"><input type="password" required minLength={6} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          {msg && <p className={`auth-msg ${msg.kind}`} role="status">{msg.text}</p>}
          <Button type="submit" disabled={busy} className="auth-submit">{busy ? 'One moment' : mode === 'in' ? 'Sign in' : 'Create account'}</Button>
        </form>
        </div>
        <button className="auth-switch" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setMsg(null); }}>
          {mode === 'in' ? 'First time here? Create your account' : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  );
}
