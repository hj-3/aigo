import { useQuery } from '@tanstack/react-query';
import { GitBranch, Check, X } from 'lucide-react';
import { api } from '@/lib/api-client';
import { formatDate } from '@/lib/utils';

interface Repository {
  readonly repoId: string;
  readonly name: string;
  readonly fullName: string;
  readonly defaultBranch: string;
  readonly config: { readonly autoAnalyzeOnPR: boolean };
  readonly lastAnalyzedAt?: string;
  readonly createdAt: string;
}

export function RepositoriesPage() {
  const { data: repos, isLoading } = useQuery<Repository[]>({
    queryKey: ['repositories'],
    queryFn: () => api.get<Repository[]>('/repositories'),
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">리포지토리</h1>

      {isLoading && <div className="text-center py-12 text-gray-500">로딩 중...</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {(repos ?? []).map((repo) => (
          <div key={repo.repoId} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
            <div className="flex items-start gap-3">
              <GitBranch className="w-5 h-5 text-gray-400 mt-0.5 flex-shrink-0" />
              <div className="min-w-0">
                <p className="font-medium text-gray-900 dark:text-white truncate">{repo.name}</p>
                <p className="text-xs text-gray-500 truncate">{repo.fullName}</p>
              </div>
            </div>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">기본 브랜치</span>
                <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">{repo.defaultBranch}</code>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-500">PR 자동 분석</span>
                {repo.config.autoAnalyzeOnPR
                  ? <span className="flex items-center gap-1 text-green-600 dark:text-green-400"><Check className="w-3.5 h-3.5" />활성</span>
                  : <span className="flex items-center gap-1 text-gray-400"><X className="w-3.5 h-3.5" />비활성</span>}
              </div>
              {repo.lastAnalyzedAt && (
                <div className="flex justify-between">
                  <span className="text-gray-500">마지막 분석</span>
                  <span className="text-gray-700 dark:text-gray-300">{formatDate(repo.lastAnalyzedAt)}</span>
                </div>
              )}
            </div>
          </div>
        ))}
        {(repos ?? []).length === 0 && !isLoading && (
          <div className="col-span-3 text-center py-12 text-gray-500">
            등록된 리포지토리가 없습니다.
          </div>
        )}
      </div>
    </div>
  );
}
