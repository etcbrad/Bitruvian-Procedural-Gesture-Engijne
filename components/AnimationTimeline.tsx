
import React, { useRef } from 'react';
import { AnimationClip } from '../types';

interface AnimationTimelineProps {
  clip: AnimationClip | null;
  currentTime: number;
  onTimeChange: (time: number) => void;
  onDeleteKeyframe: (index: number) => void;
}

export const AnimationTimeline: React.FC<AnimationTimelineProps> = ({
  clip,
  currentTime,
  onTimeChange,
  onDeleteKeyframe,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleTimelineClick = (e: React.MouseEvent) => {
    if (!clip || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const t = (x / rect.width) * clip.duration;
    onTimeChange(Math.max(0, Math.min(clip.duration, t)));
  };

  if (!clip) return <div className="p-4 text-[10px] text-mono-mid uppercase italic opacity-50">No Animation Selected</div>;

  return (
    <div className="flex flex-col gap-2 p-2 bg-mono-darker rounded border border-ridge">
      <div className="flex justify-between items-center text-[8px] font-bold uppercase text-mono-light mb-1">
        <span>Timeline: {clip.name}</span>
        <span>{currentTime.toFixed(2)}s / {clip.duration.toFixed(2)}s</span>
      </div>
      <div 
        ref={containerRef}
        className="relative h-10 bg-mono-dark border border-ridge cursor-pointer overflow-hidden"
        onClick={handleTimelineClick}
      >
        {/* Playhead */}
        <div 
          className="absolute top-0 bottom-0 w-px bg-accent-red z-20 shadow-[0_0_5px_rgba(239,68,68,0.5)]"
          style={{ left: `${(currentTime / clip.duration) * 100}%` }}
        />
        
        {/* Keyframes */}
        {clip.keyframes.map((kf, i) => (
          <div 
            key={i}
            className="absolute top-0 bottom-0 w-1.5 -ml-0.75 group cursor-pointer"
            style={{ left: `${(kf.time / clip.duration) * 100}%` }}
            onClick={(e) => { e.stopPropagation(); onTimeChange(kf.time); }}
          >
            <div className="w-full h-full bg-selection opacity-30 group-hover:opacity-60" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 bg-selection border border-paper rotate-45 shadow-sm group-hover:scale-125 transition-transform" />
            <button 
              className="absolute -top-4 left-1/2 -translate-x-1/2 hidden group-hover:block text-accent-red font-bold hover:scale-110"
              onClick={(e) => { e.stopPropagation(); onDeleteKeyframe(i); }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
