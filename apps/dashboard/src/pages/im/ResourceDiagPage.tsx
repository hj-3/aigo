import { useState, useRef, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { imApi } from '@/lib/im-api-client';
import { cn } from '@/lib/utils';
import { Send, FileText } from 'lucide-react';

const AWS_SERVICES = ['EC2', 'RDS', 'ECS', 'Lambda', 'ElastiCache', 'DynamoDB', 'S3', 'CloudFront', 'ALB'];

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

interface ChatResp {
  response: string;
  convId: string;
}

export function IMResourceDiagPage() {
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [convId, setConvId] = useState<string | undefined>();
  const bottomRef = useRef<HTMLDivElement>(null);

  // Use a fixed "resource-diag" incident ID for chat
  const DIAG_INCIDENT_ID = 'resource-diag';

  const send = useMutation({
    mutationFn: (message: string) =>
      imApi.post<ChatResp>(`/chat/${DIAG_INCIDENT_ID}`, { message, convId }),
    onSuccess: (resp, message) => {
      setConvId(resp.convId);
      setMessages((msgs) => [
        ...msgs,
        { role: 'user', content: message, timestamp: new Date().toISOString() },
        { role: 'assistant', content: resp.response, timestamp: new Date().toISOString() },
      ]);
      setInput('');
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    if (!input.trim() || send.isPending || !selectedService) return;
    const msg = `[${selectedService}] ${input.trim()}`;
    send.mutate(msg);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const suggestedQuestions = [
    `최근 7일 메모리 사용 패턴 분석해줘`,
    `비정상적인 CPU 급등 원인 파악해줘`,
    `현재 에러율이 높은 이유 분석해줘`,
    `응답 지연이 발생하는 구간 찾아줘`,
  ];

  return (
    <div className="flex h-[calc(100vh-96px)] gap-4">
      {/* Left: Service selector */}
      <div className="w-44 flex-shrink-0">
        <p className="font-mono text-[10px] text-term-secondary uppercase tracking-wider mb-3">진단 서비스 선택</p>
        <div className="space-y-0.5">
          {AWS_SERVICES.map((svc) => (
            <button
              key={svc}
              onClick={() => { setSelectedService(svc); setMessages([]); setConvId(undefined); }}
              className={cn(
                'w-full text-left px-2.5 py-2 rounded text-xs font-mono transition-colors',
                selectedService === svc
                  ? 'bg-accent/10 text-accent'
                  : 'text-term-secondary hover:text-term hover:bg-white/5',
              )}
            >
              <span className={cn('w-3 inline-block', selectedService === svc ? 'text-accent font-bold' : 'text-term-secondary/30')}>
                {selectedService === svc ? '›' : '·'}
              </span>{' '}
              {svc}
            </button>
          ))}
        </div>
      </div>

      {/* Right: Chat */}
      <div className="flex-1 flex flex-col card overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-term flex items-center justify-between flex-shrink-0">
          <div>
            <p className="font-mono text-xs font-bold text-term">
              {selectedService ? (
                <><span className="text-accent">›</span> {selectedService} 진단</>
              ) : (
                <span className="text-term-secondary">서비스를 선택하세요</span>
              )}
            </p>
            {selectedService && (
              <p className="font-mono text-[10px] text-term-secondary mt-0.5">AI 채팅으로 리소스 이상 징후를 진단합니다</p>
            )}
          </div>
          {messages.length > 0 && (
            <button className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-mono text-green-400 border border-green-400/40 rounded hover:bg-green-400/10">
              <FileText className="w-3 h-3" />
              진단 보고서
            </button>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!selectedService && (
            <div className="flex items-center justify-center h-full">
              <p className="font-mono text-xs text-term-secondary">왼쪽에서 진단할 AWS 서비스를 선택하세요</p>
            </div>
          )}

          {selectedService && messages.length === 0 && (
            <div className="space-y-3">
              <p className="font-mono text-xs text-term-secondary">{selectedService} 진단 가능한 질문 예시:</p>
              {suggestedQuestions.map((q, i) => (
                <button
                  key={i}
                  onClick={() => setInput(q)}
                  className="block w-full text-left px-3 py-2 rounded bg-canvas border border-term/30 hover:border-accent/40 font-mono text-xs text-term-secondary hover:text-term transition-colors"
                >
                  <span className="text-accent">$</span> {q}
                </button>
              ))}
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div className={cn(
                'max-w-[85%] rounded px-3 py-2 font-mono text-xs leading-relaxed',
                msg.role === 'user'
                  ? 'bg-accent/10 border border-accent/20 text-term'
                  : 'bg-canvas border border-term/40 text-term',
              )}>
                {msg.role === 'assistant' && (
                  <p className="text-[9px] text-accent mb-1.5">AIGO AI ›</p>
                )}
                <p className="whitespace-pre-wrap">{msg.content}</p>
                <p className="text-[9px] text-term-secondary/50 mt-1.5 text-right">
                  {new Date(msg.timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          ))}

          {send.isPending && (
            <div className="flex justify-start">
              <div className="bg-canvas border border-term/40 rounded px-3 py-2 font-mono text-xs text-term-secondary">
                <span className="animate-pulse">분석 중...</span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="px-4 py-3 border-t border-term flex-shrink-0">
          <div className="flex gap-2">
            <input
              className="flex-1 bg-canvas border border-term rounded px-3 py-2 text-xs font-mono text-term placeholder:text-term-secondary/40 focus:outline-none focus:border-accent"
              placeholder={selectedService ? `${selectedService} 리소스에 대해 질문하세요...` : '서비스를 먼저 선택하세요'}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={!selectedService || send.isPending}
            />
            <button
              onClick={handleSend}
              disabled={!selectedService || !input.trim() || send.isPending}
              className="px-3 py-2 text-xs font-mono text-accent border border-accent/40 rounded hover:bg-accent/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
