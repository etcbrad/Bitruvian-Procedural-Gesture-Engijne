import { create } from 'zustand';
import { WalkingEnginePose, WalkingEngineGait, WalkingEnginePivotOffsets, WalkingEngineProportions, IdleSettings, PhysicsControls, LotteSettings, CharacterMorphology, MicroScriptInstance, Vector2D } from './types';
import { DEFAULT_RESTING_POSE, DEFAULT_IDLE_SETTINGS, DEFAULT_PIVOT_OFFSETS, DEFAULT_PROPORTIONS, DEFAULT_PHYSICS, DEFAULT_LOTTE_SETTINGS } from './constants';
import { GaitSynthesizer } from './utils/gaitSynthesis';
import { CharacterGenerator } from './utils/characterGenerator';

interface MannequinStore {
  pose: WalkingEnginePose;
  gait: WalkingEngineGait;
  idleSettings: IdleSettings;
  pivotOffsets: WalkingEnginePivotOffsets;
  proportions: WalkingEngineProportions;
  physics: PhysicsControls;
  lotteSettings: LotteSettings;
  activePins: string[];
  gravityCenter: 'left' | 'center' | 'right';
  vibeScale: number;
  
  setPose: (pose: WalkingEnginePose) => void;
  setGait: (gait: WalkingEngineGait) => void;
  setIdleSettings: (idleSettings: IdleSettings) => void;
  setPivotOffsets: (pivotOffsets: WalkingEnginePivotOffsets) => void;
  setActivePins: (pins: string[]) => void;
  setGravityCenter: (center: 'left' | 'center' | 'right') => void;
  setVibeScale: (scale: number) => void;
}

export const useMannequinStore = create<MannequinStore>((set) => ({
  pose: DEFAULT_RESTING_POSE,
  gait: GaitSynthesizer.synthesizeGait(CharacterGenerator.generateCharacter('Default'), 1.0),
  idleSettings: DEFAULT_IDLE_SETTINGS,
  pivotOffsets: DEFAULT_PIVOT_OFFSETS,
  proportions: DEFAULT_PROPORTIONS,
  physics: DEFAULT_PHYSICS,
  lotteSettings: DEFAULT_LOTTE_SETTINGS,
  activePins: [],
  gravityCenter: 'center',
  vibeScale: 1.0,

  setPose: (pose) => set({ pose }),
  setGait: (gait) => set({ gait }),
  setIdleSettings: (idleSettings) => set({ idleSettings }),
  setPivotOffsets: (pivotOffsets) => set({ pivotOffsets }),
  setActivePins: (activePins) => set({ activePins }),
  setGravityCenter: (gravityCenter) => set({ gravityCenter }),
  setVibeScale: (vibeScale) => set({ vibeScale }),
}));
