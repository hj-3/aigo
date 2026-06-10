import { useEffect, useState } from 'react';
import { signInWithRedirect } from 'aws-amplify/auth';

export function LoginPage() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    signInWithRedirect().catch((err: unknown) => {
      setError(String(err instanceof Error ? err.message : err));
    });
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="text-center space-y-4">
        <div className="flex items-center justify-center gap-2 mb-6">
          <span className="text-2xl font-bold text-gray-900">AgentOps</span>
        </div>

        {error ? (
          <div className="rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-700 max-w-sm">
            <p className="font-medium">로그인 오류</p>
            <p className="mt-1">{error}</p>
            <button
              className="mt-3 text-red-600 underline hover:text-red-800"
              onClick={() => signInWithRedirect().catch(() => {})}
            >
              다시 시도
            </button>
          </div>
        ) : (
          <p className="text-sm text-gray-500">로그인 페이지로 이동 중...</p>
        )}
      </div>
    </div>
  );
}
