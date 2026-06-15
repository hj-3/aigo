import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GitBranch, Check, X, Plus, Trash2, Settings2 } from 'lucide-react';
import { api } from '@/lib/api-client';
import { formatDate } from '@/lib/utils';

interface Repository {
  readonly repoId: string;
  readonly name: string;
  readonly fullName: string;
  readonly defaultBranch: string;
  readonly status: string;
  readonly config: {
    readonly autoAnalyzeOnPR: boolean;
    readonly notifyOnSlack: boolean;
    readonly blockMergeOnHigh: boolean;
    readonly riskThreshold: string;
  };
  readonly lastAnalyzedAt?: string;
  readonly createdAt: string;
}

export function RepositoriesPage() {
  const qc = useQueryClient();
  const [showRegister, setShowRegister] = useState(false);
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: repos, isLoading } = useQuery<Repository[]>({
    queryKey: ['repositories'],
    queryFn: () => api.get<Repository[]>('/repositories'),
  });

  const registerMutation = useMutation({
    mutationFn: (body: { fullName: string }) =>
      api.post('/repositories', { ...body, config: { autoAnalyzeOnPR: true, notifyOnSlack: true } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['repositories'] });
      setShowRegister(false);
      setFullName('');
      setError(null);
    },
    onError: (err: Error) => setError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (repoId: string) => api.delete(`/repositories/${repoId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repositories'] }),
    onError: (err: Error) => setError(err.message),
  });

  const toggleAutoAnalyzeMutation = useMutation({
    mutationFn: ({ repoId, enabled }: { repoId: string; enabled: boolean }) =>
      api.patch(`/repositories/${repoId}/config`, { config: { autoAnalyzeOnPR: enabled } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repositories'] }),
  });

  const activeRepos = (repos ?? []).filter((r) => r.status !== 'INACTIVE');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">리포지토리</h1>
          <p className="mt-1 text-sm text-gray-500">분석할 GitHub 리포지토리를 관리합니다</p>
        </div>
        <button
          onClick={() => { setShowRegister(true); setError(null); }}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          저장소 등록
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Register modal */}
      {showRegister && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">저장소 등록</h2>
            <p className="text-sm text-gray-500 mb-4">GitHub App이 설치된 리포지토리를 등록하세요</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                registerMutation.mutate({ fullName });
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  리포지토리 이름
                </label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  pattern="[\w.\-]+/[\w.\-]+"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="your-org/your-repo"
                />
                <p className="mt-1 text-xs text-gray-400">owner/repository 형식으로 입력하세요</p>
              </div>
              {registerMutation.error && (
                <p className="text-sm text-red-600">{registerMutation.error.message}</p>
              )}
              <div className="flex gap-3 pt-1">
                <button
                  type="submit"
                  disabled={registerMutation.isPending}
                  className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {registerMutation.isPending ? '등록 중...' : '등록'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowRegister(false); setFullName(''); setError(null); }}
                  className="flex-1 rounded-lg border border-gray-300 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  취소
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isLoading && <div className="text-center py-12 text-gray-500">로딩 중...</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {activeRepos.map((repo) => (
          <div
            key={repo.repoId}
            className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 group"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-3 min-w-0">
                <GitBranch className="w-5 h-5 text-gray-400 mt-0.5 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 dark:text-white truncate">{repo.name}</p>
                  <p className="text-xs text-gray-500 truncate">{repo.fullName}</p>
                </div>
              </div>
              <button
                onClick={() => {
                  if (confirm(`${repo.fullName} 등록을 해제할까요?`)) {
                    deleteMutation.mutate(repo.repoId);
                  }
                }}
                className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-all flex-shrink-0"
                title="등록 해제"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">기본 브랜치</span>
                <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
                  {repo.defaultBranch}
                </code>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-500">PR 자동 분석</span>
                <button
                  onClick={() =>
                    toggleAutoAnalyzeMutation.mutate({
                      repoId: repo.repoId,
                      enabled: !repo.config.autoAnalyzeOnPR,
                    })
                  }
                  className="flex items-center gap-1 transition-colors"
                  title="클릭하여 토글"
                >
                  {repo.config.autoAnalyzeOnPR ? (
                    <span className="flex items-center gap-1 text-green-600 dark:text-green-400 hover:text-green-800">
                      <Check className="w-3.5 h-3.5" />활성
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-gray-400 hover:text-gray-600">
                      <X className="w-3.5 h-3.5" />비활성
                    </span>
                  )}
                </button>
              </div>
              {repo.lastAnalyzedAt && (
                <div className="flex justify-between">
                  <span className="text-gray-500">마지막 분석</span>
                  <span className="text-gray-700 dark:text-gray-300">
                    {formatDate(repo.lastAnalyzedAt)}
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}

        {activeRepos.length === 0 && !isLoading && (
          <div className="col-span-3 flex flex-col items-center justify-center py-16 gap-3">
            <GitBranch className="w-12 h-12 text-gray-300" />
            <p className="text-sm text-gray-500">등록된 리포지토리가 없습니다.</p>
            <button
              onClick={() => setShowRegister(true)}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              <Plus className="w-4 h-4" />
              첫 번째 저장소 등록
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
