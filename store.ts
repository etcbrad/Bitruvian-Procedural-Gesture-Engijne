import { create } from 'zustand';
import { WalkingEnginePose, WalkingEngineGait, WalkingEnginePivotOffsets, WalkingEngineProportions, IdleSettings, PhysicsControls, LotteSettings, GaitMode } from './types';
import { DEFAULT_RESTING_POSE, DEFAULT_IDLE_SETTINGS, DEFAULT_PIVOT_OFFSETS, DEFAULT_PROPORTIONS, DEFAULT_PHYSICS, DEFAULT_LOTTE_SETTINGS } from './constants';
import { GaitSynthesizer, applyGaitModeEnvelope } from './utils/gaitSynthesis';
import { CharacterGenerator } from './utils/characterGenerator';

type StateUpdater<T> = T | ((prev: T) => T);

const resolveState = <T>(current: T, next: StateUpdater<T>): T => (
  typeof next === 'function' ? (next as (prev: T) => T)(current) : next
);

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
  
  setPose: (pose: StateUpdater<WalkingEnginePose>) => void;
  setGait: (gait: StateUpdater<WalkingEngineGait>) => void;
  setIdleSettings: (idleSettings: StateUpdater<IdleSettings>) => void;
  setPivotOffsets: (pivotOffsets: StateUpdater<WalkingEnginePivotOffsets>) => void;
  setProportions: (proportions: StateUpdater<WalkingEngineProportions>) => void;
  setActivePins: (pins: StateUpdater<string[]>) => void;
  setGravityCenter: (center: 'left' | 'center' | 'right') => void;
}

export const useMannequinStore = create<MannequinStore>((set) => ({
  pose: DEFAULT_RESTING_POSE,
  gait: applyGaitModeEnvelope(
    GaitSynthesizer.synthesizeGait(CharacterGenerator.generateCharacter('Default'), 1.0),
    'walk' satisfies GaitMode
  ),
  idleSettings: DEFAULT_IDLE_SETTINGS,
  pivotOffsets: DEFAULT_PIVOT_OFFSETS,
  proportions: DEFAULT_PROPORTIONS,
  physics: DEFAULT_PHYSICS,
  lotteSettings: DEFAULT_LOTTE_SETTINGS,
  activePins: [],
  gravityCenter: 'center',

  setPose: (pose) => set((state) => ({ pose: resolveState(state.pose, pose) })),
  setGait: (gait) => set((state) => ({ gait: resolveState(state.gait, gait) })),
  setIdleSettings: (idleSettings) => set((state) => ({ idleSettings: resolveState(state.idleSettings, idleSettings) })),
  setPivotOffsets: (pivotOffsets) => set((state) => ({ pivotOffsets: resolveState(state.pivotOffsets, pivotOffsets) })),
  setProportions: (proportions) => set((state) => ({ proportions: resolveState(state.proportions, proportions) })),
  setActivePins: (activePins) => set((state) => ({ activePins: resolveState(state.activePins, activePins) })),
  setGravityCenter: (gravityCenter) => set({ gravityCenter }),
}));
