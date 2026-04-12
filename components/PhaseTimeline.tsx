import React from 'react';
import { PhaseKeyframe, PhaseTimelineMarker, circularPhaseDistance, normalizePhase } from '../utils/phaseKeyframes';

type PhaseTimelineProps = {
  phase: number;
  keyframes: PhaseKeyframe[];
  markers: PhaseTimelineMarker[];
  authoringEnabled: boolean;
  onPhaseChange: (nextPhase: number) => void;
  onMarkerClick: (marker: PhaseTimelineMarker) => void;
  onDropKey: () => void;
};

export const PhaseTimeline: React.FC<PhaseTimelineProps> = ({
  phase,
  keyframes,
  markers,
  authoringEnabled,
  onPhaseChange,
  onMarkerClick,
  onDropKey,
}) => {
  const normalizedPhase = normalizePhase(phase);

  return (
    <div className="rounded border border-ridge bg-white/80 p-2 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[7px] font-black uppercase tracking-[0.26em] text-mono-light">Phase Map</div>
          <div className="mt-0.5 text-[8px] font-black uppercase tracking-[0.2em] text-selection">
            {Math.round(normalizedPhase * 100)}%
          </div>
        </div>
        <button
          type="button"
          onClick={onDropKey}
          disabled={!authoringEnabled}
          className="rounded border border-selection bg-selection px-3 py-1.5 text-[7px] font-black uppercase tracking-[0.22em] text-white transition-all hover:bg-selection-light disabled:cursor-not-allowed disabled:opacity-50"
        >
          Drop Pose Key
        </button>
      </div>

      <div className="relative mt-3 h-10">
        <div className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-ridge/70" />
        <div
          className={`absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full transition-all ${
            authoringEnabled ? 'bg-selection' : 'bg-mono-light/60'
          }`}
          style={{ width: `${normalizedPhase * 100}%` }}
        />

        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={normalizedPhase}
          onChange={(event) => onPhaseChange(parseFloat(event.target.value))}
          disabled={!authoringEnabled}
          className={`absolute inset-0 h-full w-full appearance-none bg-transparent ${
            authoringEnabled ? 'cursor-pointer' : 'cursor-default'
          }`}
          aria-label="Phase timeline"
        />

        <div className="pointer-events-none absolute inset-0">
          {markers.map((marker, markerIndex) => {
            const normalizedMarker = normalizePhase(marker.phase);
            const isActive = Math.abs(normalizedMarker - normalizedPhase) < 0.001;
            return (
              <button
                key={`marker-${marker.label}-${markerIndex}`}
                type="button"
                onClick={() => onMarkerClick(marker)}
                title={`${marker.label} ${Math.round(normalizedMarker * 100)}%`}
                className="pointer-events-auto absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${normalizedMarker * 100}%` }}
              >
                <span
                  className={`block rounded-full border shadow-sm transition-all ${
                    marker.kind === 'contact'
                      ? 'h-3 w-3 border-selection bg-white'
                      : 'h-2.5 w-2.5 border-ink/35 bg-shell'
                  } ${isActive ? 'ring-2 ring-selection ring-offset-1' : ''}`}
                />
              </button>
            );
          })}

          {keyframes.map((keyframe, keyframeIndex) => {
            const normalizedFramePhase = normalizePhase(keyframe.phase);
            const isActive = Math.abs(normalizedFramePhase - normalizedPhase) < 0.001;
            const skinStrength = authoringEnabled ? Math.max(0.18, 1 - (circularPhaseDistance(normalizedFramePhase, normalizedPhase) * 1.8)) : 1;
            return (
              <span
                key={`keyframe-${keyframeIndex}`}
                title={`Key ${Math.round(normalizedFramePhase * 100)}%`}
                className={`pointer-events-none absolute top-1/2 h-5 -translate-x-1/2 -translate-y-1/2 rounded-full border transition-all ${
                  isActive ? 'border-selection bg-selection' : 'border-ink/25 bg-white'
                }`}
                style={{ left: `${normalizedFramePhase * 100}%`, width: '0.375rem', opacity: skinStrength }}
              />
            );
          })}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 text-[6px] font-black uppercase tracking-[0.22em] text-mono-light">
        <span>{authoringEnabled ? 'Onion skins active' : 'Live progress'}</span>
        <span>{keyframes.length ? `${keyframes.length} pose key${keyframes.length === 1 ? '' : 's'}` : 'No pose keys yet'}</span>
      </div>
    </div>
  );
};
