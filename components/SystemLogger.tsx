
import React, { useEffect, useRef } from 'react';

interface SystemLoggerProps {
  logs: { timestamp: string; message: string }[];
  isVisible: boolean;
}

export const SystemLogger: React.FC<SystemLoggerProps> = ({ logs, isVisible }) => {
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  if (!isVisible) {
    return null;
  }

  return (
    <div
      className="relative w-full max-h-48 bg-paper/50 rounded-lg p-3 font-mono text-mono-mid text-[10px] flex flex-col gap-1 shadow-inner border border-ridge mt-4"
    >
      <div className="border-b border-ridge pb-1 mb-1 text-ink font-bold tracking-widest">
        SYSTEM LOG
      </div>
      <div ref={logContainerRef} className="overflow-y-auto custom-scrollbar pr-2">
        {logs.map((log, index) => (
          <div key={index} className="flex">
            <span className="text-mono-light mr-2">{log.timestamp}</span>
            <span className="flex-1 whitespace-pre-wrap break-words">{log.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
