import { useState } from 'react';
import { signUp, confirmSignUp, resendSignUpCode, signIn } from 'aws-amplify/auth';
import { Link, useNavigate } from '@tanstack/react-router';
import { Terminal } from 'lucide-react';

type Step = 'register' | 'verify';

export function RegisterPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signUp({
        username: email,
        password,
        options: { userAttributes: { email, name } },
      });
      setStep('verify');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await confirmSignUp({ username: email, confirmationCode: code });
      // Sign in directly to avoid Hosted UI race condition in beforeLoad
      await signIn({ username: email, password });
      navigate({ to: '/onboarding' });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    try {
      await resendSignUpCode({ username: email });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas">
      <div className="w-full max-w-sm space-y-6">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-[var(--accent)]/10 border border-[var(--accent)]/20 flex items-center justify-center">
            <Terminal className="w-6 h-6 text-accent" />
          </div>
          <div className="text-center">
            <h1 className="font-mono text-lg font-bold text-term">AgentOps</h1>
            <p className="font-mono text-xs text-term-secondary mt-0.5">
              {step === 'register' ? '새 계정 등록' : '이메일 인증 코드 입력'}
            </p>
          </div>
        </div>

        <div className="card p-0 overflow-hidden">
          {/* Terminal title bar */}
          <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-term bg-canvas/50">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
            <span className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
            <span className="ml-2 font-mono text-[10px] text-term-secondary">
              {step === 'register' ? 'register.sh' : 'verify.sh'}
            </span>
          </div>

          <div className="px-5 py-5 space-y-4">
            {/* Prompt line */}
            <p className="font-mono text-xs text-term-secondary">
              <span className="text-accent">$ </span>
              {step === 'register' ? 'user create --provider email' : `verify --email ${email}`}
            </p>

            {error && (
              <div className="px-3 py-2 rounded border border-red-500/30 bg-red-500/5 font-mono text-xs text-red-400">
                ✗ {error}
              </div>
            )}

            {step === 'register' ? (
              <form onSubmit={handleRegister} className="space-y-3">
                <div>
                  <label className="block text-[10px] font-mono text-term-secondary mb-1">--name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    className="input-term"
                    placeholder="홍길동"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono text-term-secondary mb-1">--email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="input-term"
                    placeholder="you@company.com"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono text-term-secondary mb-1">--password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    className="input-term"
                    placeholder="8자 이상, 영문/숫자/특수문자"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary w-full"
                >
                  {loading ? '$ creating user...' : '$ create user'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleVerify} className="space-y-3">
                <div>
                  <label className="block text-[10px] font-mono text-term-secondary mb-1">--code (6자리)</label>
                  <input
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    required
                    maxLength={6}
                    className="input-term text-center tracking-[0.4em] text-lg"
                    placeholder="000000"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary w-full"
                >
                  {loading ? '$ verifying...' : '$ verify email'}
                </button>
                <button
                  type="button"
                  onClick={handleResend}
                  className="btn-ghost w-full text-xs"
                >
                  $ resend code
                </button>
              </form>
            )}

            <p className="font-mono text-[10px] text-term-secondary">
              이미 계정이 있으신가요?{' '}
              <Link to="/login" className="text-accent hover:underline">
                $ login
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
