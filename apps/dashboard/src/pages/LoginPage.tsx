import { useEffect, useState } from 'react';
import { signInWithRedirect, getCurrentUser } from 'aws-amplify/auth';
import { useNavigate } from '@tanstack/react-router';
import { Terminal } from 'lucide-react';

export function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    getCurrentUser()
      .then(() => {
        // Session exists — navigate without a full page reload so Amplify
        // stays initialized and protectedRoute.beforeLoad sees the user.
        navigate({ to: '/' });
      })
      .catch(() => {
        signInWithRedirect().catch((err: unknown) => {
          const msg = String(err instanceof Error ? err.message : err);
          // "There is already a signed in user" → tokens exist but router
          // context is stale; same-session navigate to re-run beforeLoad.
          if (msg.toLowerCase().includes('already')) {
            navigate({ to: '/' });
            return;
          }
          setError(msg);
        });
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
            <p className="font-mono text-xs text-term-secondary mt-0.5">AI DevOps Automation Platform</p>
          </div>
        </div>

        {/* Terminal card */}
        <div className="card p-0 overflow-hidden">
          <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-term bg-canvas/50">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
            <span className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
            <span className="ml-2 font-mono text-[10px] text-term-secondary">auth.sh</span>
          </div>

          <div className="px-5 py-6 font-mono text-xs space-y-2.5">
            <p className="text-term-secondary">$ auth --provider cognito --redirect</p>

            {error ? (
              <>
                <p className="text-red-400">✗ {error}</p>
                <button
                  onClick={() => {
                    setError(null);
                    signInWithRedirect().catch((e: unknown) => {
                      setError(String(e instanceof Error ? e.message : e));
                    });
                  }}
                  className="btn-primary w-full mt-2"
                >
                  $ retry
                </button>
              </>
            ) : (
              <p className="text-yellow-400">
                <span className="animate-pulse inline-block mr-1">⟳</span>
                Cognito 로그인 페이지로 이동 중...
              </p>
            )}
          </div>
        </div>

        <p className="text-center font-mono text-[10px] text-term-secondary/50">
          Powered by AWS Cognito Managed Login
        </p>
      </div>
    </div>
  );
}
