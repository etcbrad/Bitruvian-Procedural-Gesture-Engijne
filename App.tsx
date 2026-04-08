import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Mannequin } from './components/Mannequin';
import { SystemLogger } from './components/SystemLogger';
import { AdvancedGrid, Scanlines, SystemGuides } from './components/SystemGrid';
import { MANNEQUIN_LOCAL_FLOOR_Y, TIMING, UI } from './constants';
import { BehaviorEngine } from './utils/behaviorEngine';
import { applyFootGrounding } from './utils/groundingEngine';
import { updateIdlePhysics } from './utils/idleEngine';
import {
  INITIAL_LOCOMOTION_STATE,
  updateLocomotionPhysics,
  type LocomotionState,
} from './utils/locomotionEngine';
import { applyGaitModeEnvelope, normalizeGaitModeEnvelope } from './utils/gaitSynthesis';
import { lerp, clamp } from './utils/kinematics';
import { exportAnimatedLoop, exportKeyframes, exportLoopFrames, type AnimatedExportFormat } from './utils/animationExport';
import { POSE_LIBRARY_BY_ID, POSE_LIBRARY_CATEGORIES, POSE_LIBRARY_DB } from './utils/poseLibraryDb';
import { poseToString, stringToPose } from './utils/poseParser';
import {
  applyCompiledWalkKeyPoseOverlay,
  captureWalkKeyPoseAnchor,
  compileWalkKeyPoseSet,
  createNeutralWalkKeyPoseSetFromGait,
  findNearestWalkKeyPoseId,
  resetWalkKeyPoseAnchor,
  setWalkKeyPoseEasing,
  setWalkKeyPoseMirror,
  setWalkKeyPosePhase,
  syncNeutralWalkKeyPoseSetToGait,
  WALK_KEY_POSE_EASING_OPTIONS,
  WALK_KEY_POSE_IDS,
} from './utils/walkKeyPoses';
import { useMannequinStore } from './store';
import {
  EasingType,
  GaitMode,
  IdleSettings,
  PoseLibraryEntry,
  WalkKeyPoseId,
  WalkKeyPoseSet,
  WalkingEngineGait,
  WalkingEnginePivotOffsets,
  WalkingEnginePose,
} from './types';

const DEFAULT_BASE_UNIT_H = 150;
const STAGE_VIEW_BOX = UI.BASE_VIEWBOX;
const STAGE_VIEW_BOX_STRING = `${STAGE_VIEW_BOX.x} ${STAGE_VIEW_BOX.y} ${STAGE_VIEW_BOX.width} ${STAGE_VIEW_BOX.height}`;
const STAGE_GROUND_Y = UI.BASE_VIEWBOX.y + UI.BASE_VIEWBOX.height - 4;
const STAGE_GRID_SIZE = 120;

type ShellMode = 'runtime' | 'editor';
type MotionMode = 'locomotion' | 'idle';
type StrideEntryStyle = 'tiptoe' | 'neutral' | 'drive';

const gaitSliderConfig: Partial<Record<keyof WalkingEngineGait, { min: number; max: number; step: number; label: string; category: string }>> = {
  intensity: { min: 0, max: 2, step: 0.01, label: 'Kinetic Intensity', category: 'Primary' },
  frequency: { min: 0.1, max: 3, step: 0.01, label: 'Cycle Frequency', category: 'Primary' },
  stride: { min: 0, max: 2, step: 0.01, label: 'Stride Band', category: 'Primary' },
  lean: { min: -1.5, max: 1.5, step: 0.01, label: 'Pelvic Lean', category: 'Body' },
  upper_body_lean: { min: -1, max: 1, step: 0.01, label: 'Thoracic Pitch', category: 'Body' },
  hip_sway: { min: 0, max: 2.5, step: 0.01, label: 'Lateral Sway', category: 'Body' },
  waist_twist: { min: 0, max: 3.5, step: 0.01, label: 'Torque Rotation', category: 'Body' },
  torso_swivel: { min: 0, max: 1.5, step: 0.01, label: 'Counter Rotation', category: 'Body' },
  arm_swing: { min: 0, max: 2.5, step: 0.01, label: 'Swing Amplitude', category: 'Arms' },
  arm_spread: { min: 0, max: 2.0, step: 0.01, label: 'Scapular Abduction', category: 'Arms' },
  elbow_bend: { min: 0, max: 2.0, step: 0.01, label: 'Bicep Flexion', category: 'Arms' },
  elbowFlexibility: { min: 0, max: 1, step: 0.01, label: 'Tendon Elasticity', category: 'Arms' },
  gravity: { min: 0, max: 1, step: 0.01, label: 'Center of Mass', category: 'Legs' },
  verticality: { min: 0, max: 1, step: 0.01, label: 'Step Magnitude', category: 'Legs' },
  kick_up_force: { min: 0, max: 1, step: 0.01, label: 'Posterior Extension', category: 'Legs' },
  foot_roll: { min: 0, max: 1, step: 0.01, label: 'Ankle Articulation', category: 'Legs' },
  toe_bend: { min: 0, max: 1, step: 0.01, label: 'Toe Bend', category: 'Legs' },
  heavyStomp: { min: 0, max: 1, step: 0.01, label: 'Impact Density', category: 'Effects' },
  footDrag: { min: 0, max: 1, step: 0.01, label: 'Frictional Drag', category: 'Effects' },
};

const strideEntryOptions: { style: StrideEntryStyle; label: string; note: string }[] = [
  { style: 'tiptoe', label: 'TIPTOE', note: 'forefoot' },
  { style: 'neutral', label: 'NEUTRAL', note: 'midfoot' },
  { style: 'drive', label: 'DRIVE', note: 'push-off' },
];

const gaitModeOptions: { mode: GaitMode; label: string; note: string }[] = [
  {
    mode: 'poser',
    label: 'POSER',
    note: 'static full fk',
  },
  {
    mode: 'walk',
    label: 'WALK',
    note: 'compact step band',
  },
  {
    mode: 'jog',
    label: 'JOG',
    note: 'elastic mid-band',
  },
  {
    mode: 'run',
    label: 'RUN',
    note: 'extended stride band',
  },
  {
    mode: 'chaos',
    label: 'CHAOS',
    note: 'unbounded gait chaos',
  },
];

const STRIDE_BANDS: Record<GaitMode, { uiMin: number; uiMax: number; actualMin: number; actualMax: number }> = {
  poser: { uiMin: 0, uiMax: 100, actualMin: 0, actualMax: 2 },
  walk: { uiMin: 0, uiMax: 50, actualMin: 0.12, actualMax: 0.65 },
  jog: { uiMin: 50, uiMax: 75, actualMin: 0.65, actualMax: 1.22 },
  run: { uiMin: 75, uiMax: 100, actualMin: 1.22, actualMax: 1.95 },
  chaos: { uiMin: 0, uiMax: 100, actualMin: 0, actualMax: 2.5 },
};

type GaitAdjustment = { mul?: number; add?: number; min?: number; max?: number };

const STRIDE_ENTRY_STYLE_ADJUSTMENTS: Record<StrideEntryStyle, Partial<Record<keyof WalkingEngineGait, GaitAdjustment>>> = {
  tiptoe: {
    verticality: { mul: 1.06, min: 0.25, max: 1.25 },
    foot_roll: { mul: 1.16, min: 0.2, max: 1.4 },
    kick_up_force: { mul: 1.1, min: 0.08, max: 1.35 },
    footDrag: { mul: 0.94, min: 0.08, max: 1.15 },
  },
  neutral: {},
  drive: {
    intensity: { mul: 1.04, min: 0.45, max: 2.2 },
    foot_roll: { mul: 0.94, min: 0.08, max: 1.25 },
    kick_up_force: { mul: 1.08, min: 0.08, max: 1.35 },
    footDrag: { mul: 0.9, min: 0.05, max: 1.0 },
  },
};

const coreGaitKeys: (keyof WalkingEngineGait)[] = ['intensity', 'frequency', 'stride', 'verticality', 'arm_swing', 'footDrag'];
const advancedGaitKeys = (Object.keys(gaitSliderConfig) as (keyof WalkingEngineGait)[]).filter((key) => !coreGaitKeys.includes(key));
const gaitKeyGroups: Record<'core' | 'advanced', (keyof WalkingEngineGait)[]> = {
  core: coreGaitKeys,
  advanced: advancedGaitKeys,
};

const normalizePhase = (phase: number): number => ((phase % 1) + 1) % 1;
const phaseToPercent = (phase: number): number => Math.round(normalizePhase(phase) * 100);

const applyGaitAdjustments = (gait: WalkingEngineGait, adjustments: Partial<Record<keyof WalkingEngineGait, GaitAdjustment>>): WalkingEngineGait => {
  const next = { ...gait };
  (Object.keys(adjustments) as (keyof WalkingEngineGait)[]).forEach((key) => {
    const adjustment = adjustments[key];
    if (!adjustment) return;
    const scaled = (next[key] * (adjustment.mul ?? 1)) + (adjustment.add ?? 0);
    const min = adjustment.min ?? Number.NEGATIVE_INFINITY;
    const max = adjustment.max ?? Number.POSITIVE_INFINITY;
    next[key] = clamp(scaled, min, max);
  });
  return next;
};

const normalizeGaitAdjustments = (gait: WalkingEngineGait, adjustments: Partial<Record<keyof WalkingEngineGait, GaitAdjustment>>): WalkingEngineGait => {
  const next = { ...gait };
  (Object.keys(adjustments) as (keyof WalkingEngineGait)[]).forEach((key) => {
    const adjustment = adjustments[key];
    if (!adjustment) return;
    const mul = adjustment.mul ?? 1;
    if (mul === 0) return;
    next[key] = (next[key] - (adjustment.add ?? 0)) / mul;
  });
  return next;
};

const mapStridePercentToValue = (mode: GaitMode, percent: number) => {
  const band = STRIDE_BANDS[mode];
  const normalized = clamp((percent - band.uiMin) / (band.uiMax - band.uiMin), 0, 1);
  return lerp(band.actualMin, band.actualMax, normalized);
};

const mapStrideValueToPercent = (mode: GaitMode, value: number) => {
  const band = STRIDE_BANDS[mode];
  const normalized = clamp((value - band.actualMin) / (band.actualMax - band.actualMin), 0, 1);
  return lerp(band.uiMin, band.uiMax, normalized);
};

const Section: React.FC<{
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, count, defaultOpen = true, children }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <section className="border-b border-ridge/60 pb-3 last:border-b-0 last:pb-0">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-3 py-2 text-left text-[9px] font-black uppercase tracking-[0.28em] text-ink transition-colors hover:text-selection"
      >
        <span>{title}</span>
        <span className="flex items-center gap-2">
          {count !== undefined && (
            <span className="rounded border border-ridge bg-white px-2 py-0.5 text-[7px] tracking-[0.2em] text-mono-light">
              {count}
            </span>
          )}
          <span className="text-[10px] text-mono-light">{isOpen ? '−' : '+'}</span>
        </span>
      </button>
      {isOpen && <div className="mt-3 space-y-3">{children}</div>}
    </section>
  );
};

const ToggleChip: React.FC<{
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  title?: string;
}> = ({ active, onClick, children, disabled = false, title }) => (
  <button
    type="button"
    title={title}
    onClick={onClick}
    disabled={disabled}
    className={`rounded-full border px-3 py-1.5 text-[8px] font-black uppercase tracking-[0.24em] transition-all ${
      disabled
        ? 'cursor-not-allowed border-ridge bg-white text-mono-light opacity-50'
        : active
          ? 'border-selection bg-selection text-white shadow-md'
          : 'border-ridge bg-white text-ink hover:bg-shell'
    }`}
  >
    {children}
  </button>
);

const RangeControl: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (next: number) => void;
  displayValue?: string;
  helper?: string;
  disabled?: boolean;
}> = ({ label, value, min, max, step, onChange, displayValue, helper, disabled = false }) => (
  <label className={`flex flex-col gap-1.5 ${disabled ? 'opacity-60' : ''}`}>
    <div className="flex items-center justify-between text-[7px] font-black uppercase tracking-[0.24em] text-mono-light">
      <span>{label}</span>
      <span className="text-selection">{displayValue ?? value.toFixed(2)}</span>
    </div>
    {helper && <div className="text-[6px] font-black uppercase tracking-[0.24em] text-mono-light">{helper}</div>}
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(parseFloat(event.target.value))}
      disabled={disabled}
      className="h-1 w-full accent-selection"
    />
  </label>
);

const App: React.FC = () => {
  const {
    pose,
    gait,
    idleSettings,
    pivotOffsets,
    proportions,
    physics,
    lotteSettings,
    activePins,
    gravityCenter,
    setPose,
    setGait,
    setIdleSettings,
    setActivePins,
    setGravityCenter,
  } = useMannequinStore();

  const [shellMode, setShellMode] = useState<ShellMode>('runtime');
  const [motionMode, setMotionMode] = useState<MotionMode>('locomotion');
  const [showPivots, setShowPivots] = useState(true);
  const [showLabels, setShowLabels] = useState(false);
  const [showConsole, setShowConsole] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [targetFps, setTargetFps] = useState(TIMING.DEFAULT_TARGET_FPS);
  const [exportFormat, setExportFormat] = useState<AnimatedExportFormat>('gif');
  const [isExporting, setIsExporting] = useState(false);
  const [pendingExport, setPendingExport] = useState<{ mode: 'frames' | 'keyframes' | 'animated' } | null>(null);
  const [selectedLibraryId, setSelectedLibraryId] = useState(POSE_LIBRARY_DB[0]?.id ?? '');
  const [walkKeyPoseSet, setWalkKeyPoseSet] = useState<WalkKeyPoseSet>(() => createNeutralWalkKeyPoseSetFromGait(gait, physics));
  const [keyPoseEditorPlaying, setKeyPoseEditorPlaying] = useState(true);
  const [keyPosePreviewPhase, setKeyPosePreviewPhase] = useState(pose.stride_phase ?? 0);
  const [tensions, setTensions] = useState<Record<string, number>>({});
  const [groundingState, setGroundingState] = useState<{
    weightBearingFoot: 'left' | 'right' | 'both';
    swingFoot: 'left' | 'right' | null;
    contactPose: boolean;
    leftContact: number;
    rightContact: number;
    supportLoad: number;
    groundBounce: number;
    leftChain: number;
    rightChain: number;
    leftCompression: number;
    rightCompression: number;
  } | null>(null);
  const [systemLogs, setSystemLogs] = useState<{ timestamp: string; message: string }[]>([]);

  const activePinsList = Array.isArray(activePins) ? activePins : [];
  const keyPoseMode = shellMode === 'editor';
  const displayLabels = showLabels || keyPoseMode;
  const displayPivots = showPivots || keyPoseMode;
  const selectedAnchor = walkKeyPoseSet.anchors[walkKeyPoseSet.selectedAnchorId];
  const selectedLibraryEntry = useMemo(() => POSE_LIBRARY_BY_ID[selectedLibraryId] ?? POSE_LIBRARY_DB[0], [selectedLibraryId]);
  const selectedLibraryPose = useMemo(() => stringToPose(selectedLibraryEntry.data), [selectedLibraryEntry]);
  const selectedLibraryPoseString = useMemo(() => poseToString(selectedLibraryPose), [selectedLibraryPose]);
  const selectedAnchorPoseString = useMemo(() => poseToString(selectedAnchor.pose), [selectedAnchor]);
  const selectedLibraryGroups = useMemo(() => POSE_LIBRARY_CATEGORIES.map((category) => ({
    category,
    entries: POSE_LIBRARY_DB.filter((entry) => entry.cat === category),
  })), []);
  const exportFps = Math.min(24, targetFps);

  const locomotionStateRef = useRef<LocomotionState>({ ...INITIAL_LOCOMOTION_STATE });
  const lastFrameTimeRef = useRef(0);
  const locomotionWeightRef = useRef(1.0);
  const gaitModeRef = useRef<GaitMode>('walk');
  const strideEntryStyleRef = useRef<StrideEntryStyle>('tiptoe');
  const gaitBaseRef = useRef<WalkingEngineGait>(normalizeGaitModeEnvelope(gait, gaitModeRef.current));
  const isPausedRef = useRef(isPaused);
  const poseRef = useRef<WalkingEnginePose>(pose);
  const livePhaseRef = useRef(pose.stride_phase ?? 0);
  const keyPoseEditorPlayingRef = useRef(keyPoseEditorPlaying);
  const keyPosePreviewPhaseRef = useRef(keyPosePreviewPhase);
  const keyPoseSnapshotPoseRef = useRef<WalkingEnginePose>({ ...pose });
  const keyPoseSnapshotPhaseRef = useRef(pose.stride_phase ?? 0);
  const exportLockRef = useRef(false);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    poseRef.current = pose;
  }, [pose]);

  useEffect(() => {
    keyPoseEditorPlayingRef.current = keyPoseEditorPlaying;
  }, [keyPoseEditorPlaying]);

  useEffect(() => {
    keyPosePreviewPhaseRef.current = keyPosePreviewPhase;
  }, [keyPosePreviewPhase]);

  useEffect(() => {
    setWalkKeyPoseSet((prev) => syncNeutralWalkKeyPoseSetToGait(prev, gait, physics));
  }, [gait, physics]);

  const logSystem = useCallback((message: string) => {
    setSystemLogs((prev) => [...prev.slice(-23), { timestamp: new Date().toLocaleTimeString(), message }]);
  }, []);

  const primeEditorAtPhase = useCallback((phase: number) => {
    const normalizedPhase = normalizePhase(phase);
    keyPoseSnapshotPoseRef.current = { ...poseRef.current };
    keyPoseSnapshotPhaseRef.current = normalizedPhase;
    setShellMode('editor');
    setKeyPoseEditorPlaying(true);
    setKeyPosePreviewPhase(normalizedPhase);
    setWalkKeyPoseSet((prev) => ({
      ...prev,
      selectedAnchorId: findNearestWalkKeyPoseId(normalizedPhase, prev.anchors),
    }));
  }, []);

  const enterEditorAtPhase = useCallback((phase: number) => {
    primeEditorAtPhase(phase);
    logSystem(`Shell: editor @ ${phaseToPercent(phase)}%`);
  }, [logSystem, primeEditorAtPhase]);

  const exitEditor = useCallback(() => {
    setShellMode('runtime');
    setKeyPoseEditorPlaying(false);
    logSystem('Shell: runtime');
  }, [logSystem]);

  const toggleEditorPlayback = useCallback(() => {
    if (!keyPoseMode) return;

    if (keyPoseEditorPlayingRef.current) {
      keyPoseSnapshotPoseRef.current = { ...poseRef.current };
      keyPoseSnapshotPhaseRef.current = keyPosePreviewPhaseRef.current;
      setKeyPoseEditorPlaying(false);
      logSystem('Editor: frozen scrub');
      return;
    }

    const currentPhase = livePhaseRef.current ?? poseRef.current.stride_phase ?? 0;
    setKeyPosePreviewPhase(currentPhase);
    setKeyPoseEditorPlaying(true);
    logSystem('Editor: live follow');
  }, [keyPoseMode, logSystem]);

  const applyLibraryEntry = useCallback((entry: PoseLibraryEntry, anchorOverride?: WalkKeyPoseId) => {
    const phase = normalizePhase(entry.phaseHint);
    const poseFromLibrary = stringToPose(entry.data);

    primeEditorAtPhase(phase);
    setSelectedLibraryId(entry.id);
    setWalkKeyPoseSet((prev) => {
      const targetAnchorId = anchorOverride ?? findNearestWalkKeyPoseId(phase, prev.anchors);
      return {
        ...prev,
        selectedAnchorId: targetAnchorId,
        anchors: {
          ...prev.anchors,
          [targetAnchorId]: {
            ...prev.anchors[targetAnchorId],
            phase,
            mirror: Boolean(entry.mirrored),
            authored: true,
            pose: { ...poseFromLibrary, stride_phase: phase },
          },
        },
      };
    });
    logSystem(`Library seed: ${entry.id} ${entry.name}`);
  }, [logSystem, primeEditorAtPhase]);

  const applyDisplayedGaitFromBase = useCallback((nextBase: WalkingEngineGait) => {
    gaitBaseRef.current = nextBase;
    const modeGait = applyGaitModeEnvelope(nextBase, gaitModeRef.current);
    setGait(applyGaitAdjustments(modeGait, STRIDE_ENTRY_STYLE_ADJUSTMENTS[strideEntryStyleRef.current]));
  }, [setGait]);

  const updateDisplayedGaitValue = useCallback((key: keyof WalkingEngineGait, value: number) => {
    setGait((prev) => {
      const modeNormalized = normalizeGaitModeEnvelope(prev, gaitModeRef.current);
      const baseNormalized = normalizeGaitAdjustments(modeNormalized, STRIDE_ENTRY_STYLE_ADJUSTMENTS[strideEntryStyleRef.current]);
      const nextBase = { ...baseNormalized, [key]: value };
      gaitBaseRef.current = nextBase;
      const modeGait = applyGaitModeEnvelope(nextBase, gaitModeRef.current);
      return applyGaitAdjustments(modeGait, STRIDE_ENTRY_STYLE_ADJUSTMENTS[strideEntryStyleRef.current]);
    });
  }, [setGait]);

  const updateGaitMode = useCallback((mode: GaitMode) => {
    gaitModeRef.current = mode;
    const modeGait = applyGaitModeEnvelope(gaitBaseRef.current, mode);
    setGait(applyGaitAdjustments(modeGait, STRIDE_ENTRY_STYLE_ADJUSTMENTS[strideEntryStyleRef.current]));
    logSystem(`Gait Mode: ${mode.toUpperCase()}`);
  }, [setGait, logSystem]);

  const updateStrideEntryStyle = useCallback((style: StrideEntryStyle) => {
    strideEntryStyleRef.current = style;
    const modeGait = applyGaitModeEnvelope(gaitBaseRef.current, gaitModeRef.current);
    setGait(applyGaitAdjustments(modeGait, STRIDE_ENTRY_STYLE_ADJUSTMENTS[style]));
    logSystem(`Stride Entry: ${style.toUpperCase()}`);
  }, [setGait, logSystem]);

  useEffect(() => {
    applyDisplayedGaitFromBase(gaitBaseRef.current);
  }, [applyDisplayedGaitFromBase]);

  const generateBasePoseAtPhase = useCallback((phase: number) => {
    const p = normalizePhase(phase) * Math.PI * 2;
    const locPose = updateLocomotionPhysics(p, { ...INITIAL_LOCOMOTION_STATE }, gait, physics, 1.0);
    const grounded = applyFootGrounding(locPose, proportions, DEFAULT_BASE_UNIT_H, physics, activePinsList, idleSettings, gravityCenter, 1.0, 16);
    return grounded.adjustedPose as WalkingEnginePose;
  }, [activePinsList, gait, gravityCenter, idleSettings, physics, proportions]);

  const toggleAnchorPin = useCallback((boneKey: keyof WalkingEnginePivotOffsets) => {
    setActivePins((prev) => {
      const next = prev.includes(boneKey) ? prev.filter((key) => key !== boneKey) : [...prev, boneKey];
      logSystem(`Pin: ${boneKey.toUpperCase()} ${next.includes(boneKey) ? 'ON' : 'OFF'}`);
      return next;
    });
  }, [logSystem, setActivePins]);

  const handleAnchorMouseDown = useCallback((boneKey: keyof WalkingEnginePivotOffsets) => {
    if (!isPaused || !displayPivots) return;
    toggleAnchorPin(boneKey);
  }, [displayPivots, isPaused, toggleAnchorPin]);

  const captureSelectedAnchor = useCallback(() => {
    const anchorId = walkKeyPoseSet.selectedAnchorId;
    setWalkKeyPoseSet((prev) => captureWalkKeyPoseAnchor(prev, anchorId, poseRef.current, livePhaseRef.current));
    logSystem(`Capture: ${anchorId.toUpperCase()}`);
  }, [logSystem, walkKeyPoseSet.selectedAnchorId]);

  const resetSelectedAnchor = useCallback(() => {
    const anchorId = walkKeyPoseSet.selectedAnchorId;
    setWalkKeyPoseSet((prev) => resetWalkKeyPoseAnchor(prev, anchorId, generateBasePoseAtPhase));
    logSystem(`Reset anchor: ${anchorId.toUpperCase()}`);
  }, [generateBasePoseAtPhase, logSystem, walkKeyPoseSet.selectedAnchorId]);

  const resetWalkKeyPoseSet = useCallback(() => {
    setWalkKeyPoseSet((prev) => {
      const next = createNeutralWalkKeyPoseSetFromGait(gait, physics);
      return { ...next, selectedAnchorId: prev.selectedAnchorId };
    });
    logSystem('Key pose set reset');
  }, [gait, logSystem, physics]);

  const toggleSelectedAnchorMirror = useCallback(() => {
    const anchorId = walkKeyPoseSet.selectedAnchorId;
    const nextMirror = !selectedAnchor.mirror;
    setWalkKeyPoseSet((prev) => setWalkKeyPoseMirror(prev, anchorId, nextMirror));
    logSystem(`Mirror: ${anchorId.toUpperCase()} ${nextMirror ? 'ON' : 'OFF'}`);
  }, [logSystem, selectedAnchor.mirror, walkKeyPoseSet.selectedAnchorId]);

  const applySelectedLibraryToSelectedAnchor = useCallback(() => {
    if (!selectedLibraryEntry) return;
    applyLibraryEntry(selectedLibraryEntry, walkKeyPoseSet.selectedAnchorId);
  }, [applyLibraryEntry, selectedLibraryEntry, walkKeyPoseSet.selectedAnchorId]);

  const handlePauseToggle = useCallback(() => {
    setIsPaused((prev) => !prev);
  }, []);

  useEffect(() => {
    let frame = 0;

    const animate = (time: number) => {
      frame = window.requestAnimationFrame(animate);

      if (isPausedRef.current) {
        lastFrameTimeRef.current = time;
        return;
      }

      const elapsed = time - lastFrameTimeRef.current;
      if (elapsed < 1000 / targetFps) return;
      lastFrameTimeRef.current = time;

      const targetWeight = motionMode === 'locomotion' ? 1.0 : 0.0;
      locomotionWeightRef.current = lerp(locomotionWeightRef.current, targetWeight, 0.08);
      const locWeight = locomotionWeightRef.current;

      const isStaticPoser = gaitModeRef.current === 'poser';
      const p = isStaticPoser ? 0 : (time * 0.005 * gait.frequency) % (Math.PI * 2);
      const locPoseBase = isStaticPoser
        ? generateBasePoseAtPhase(keyPosePreviewPhaseRef.current)
        : updateLocomotionPhysics(p, locomotionStateRef.current, gait, physics, locWeight);
      const locPhase = isStaticPoser
        ? keyPosePreviewPhaseRef.current
        : locPoseBase.stride_phase ?? (((p / (Math.PI * 2)) % 1) + 1) % 1;
      livePhaseRef.current = locPhase;

      if (keyPoseMode && keyPoseEditorPlayingRef.current) {
        if (Math.abs(keyPosePreviewPhaseRef.current - locPhase) > 0.0001) {
          keyPosePreviewPhaseRef.current = locPhase;
          setKeyPosePreviewPhase(locPhase);
        }
        const livePose = applyCompiledWalkKeyPoseOverlay(locPoseBase as WalkingEnginePose, locPhase, compiledKeyPoseSet);
        const grounded = applyFootGrounding(livePose, proportions, DEFAULT_BASE_UNIT_H, physics, activePinsList, idleSettings, gravityCenter, locWeight, elapsed);
        setTensions(grounded.tensions);
        setGroundingState(grounded.footState ?? null);
        setPose(grounded.adjustedPose as WalkingEnginePose);
        return;
      }

      if (keyPoseMode) {
        const frozenPhase = keyPosePreviewPhaseRef.current;
        const snapshotPhase = keyPoseSnapshotPhaseRef.current;
        const frozenBasePose = Math.abs(frozenPhase - snapshotPhase) < 0.0001
          ? keyPoseSnapshotPoseRef.current
          : generateBasePoseAtPhase(frozenPhase);
        const frozenPose = applyCompiledWalkKeyPoseOverlay(frozenBasePose as WalkingEnginePose, frozenPhase, compiledKeyPoseSet);
        const grounded = applyFootGrounding(frozenPose, proportions, DEFAULT_BASE_UNIT_H, physics, activePinsList, idleSettings, gravityCenter, locWeight, elapsed);
        setTensions(grounded.tensions);
        setGroundingState(grounded.footState ?? null);
        setPose(grounded.adjustedPose as WalkingEnginePose);
        return;
      }

      const idlePose = updateIdlePhysics(time, elapsed, idleSettings, locWeight, []);
      const blendedPose = BehaviorEngine.blendPose(locPoseBase, idlePose, {}, locWeight, gait, time);
      const grounded = applyFootGrounding(blendedPose, proportions, DEFAULT_BASE_UNIT_H, physics, activePinsList, idleSettings, gravityCenter, locWeight, elapsed);
      setTensions(grounded.tensions);
      setGroundingState(grounded.footState ?? null);
      setPose(grounded.adjustedPose as WalkingEnginePose);
    };

    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, [
    activePinsList,
    compiledKeyPoseSet,
    generateBasePoseAtPhase,
    gait,
    gravityCenter,
    idleSettings,
    keyPoseMode,
    motionMode,
    physics,
    proportions,
    setPose,
    targetFps,
  ]);

  useEffect(() => {
    const renderGameToText = () => JSON.stringify({
      shellMode,
      motionMode,
      paused: isPaused,
      showLabels,
      showPivots,
      showConsole,
      targetFps,
      exportFormat,
      pose: {
        bodyRotation: pose.bodyRotation,
        waist: pose.waist,
        torso: pose.torso,
        collar: pose.collar,
        neck: pose.neck,
        lShoulder: pose.l_shoulder,
        rShoulder: pose.r_shoulder,
        lElbow: pose.l_elbow,
        rElbow: pose.r_elbow,
        lHand: pose.l_hand,
        rHand: pose.r_hand,
        lHip: pose.l_hip,
        rHip: pose.r_hip,
        lKnee: pose.l_knee,
        rKnee: pose.r_knee,
        lFoot: pose.l_foot,
        rFoot: pose.r_foot,
        xOffset: pose.x_offset,
        yOffset: pose.y_offset,
        stridePhase: pose.stride_phase,
      },
      gait: {
        mode: gaitModeRef.current,
        entryStyle: strideEntryStyleRef.current,
        intensity: gait.intensity,
        frequency: gait.frequency,
        stride: gait.stride,
        verticality: gait.verticality,
        armSwing: gait.arm_swing,
        footDrag: gait.footDrag,
        gravity: gait.gravity,
      },
      idle: {
        breathing: idleSettings.breathing,
        weightShift: idleSettings.weightShift,
        gazeSway: idleSettings.gazeSway,
        tension: idleSettings.tension,
        fidgetFrequency: idleSettings.fidgetFrequency,
        transitionSpeed: idleSettings.transitionSpeed,
        posture: idleSettings.posture,
        idlePinnedFeet: idleSettings.idlePinnedFeet,
      },
      balance: {
        gravityCenter,
        activePins: activePinsList,
      },
      selectedLibrary: selectedLibraryEntry ? {
        id: selectedLibraryEntry.id,
        name: selectedLibraryEntry.name,
        cat: selectedLibraryEntry.cat,
        phaseHint: selectedLibraryEntry.phaseHint,
        mirrored: Boolean(selectedLibraryEntry.mirrored),
        data: selectedLibraryPoseString,
      } : null,
      keyPose: {
        active: keyPoseMode,
        playing: keyPoseEditorPlaying,
        previewPhase: keyPosePreviewPhase,
        selectedAnchorId: walkKeyPoseSet.selectedAnchorId,
        selectedAnchor: {
          phase: selectedAnchor.phase,
          easing: selectedAnchor.easing,
          mirror: selectedAnchor.mirror,
          authored: selectedAnchor.authored,
          data: selectedAnchorPoseString,
        },
        keyPoseSet: walkKeyPoseSet,
      },
      grounding: groundingState,
      logs: systemLogs.slice(-5),
      exporting: {
        active: isExporting,
        pending: pendingExport?.mode ?? null,
      },
    });

    (window as Window & { render_game_to_text?: () => string }).render_game_to_text = renderGameToText;
    return () => {
      const target = window as Window & { render_game_to_text?: () => string };
      if (target.render_game_to_text === renderGameToText) delete target.render_game_to_text;
    };
  }, [
    activePinsList,
    exportFormat,
    groundingState,
    gravityCenter,
    idleSettings,
    isExporting,
    isPaused,
    keyPoseEditorPlaying,
    keyPoseMode,
    keyPosePreviewPhase,
    motionMode,
    pendingExport?.mode,
    pose,
    selectedAnchor.authored,
    selectedAnchor.easing,
    selectedAnchor.mirror,
    selectedAnchor.phase,
    selectedAnchorPoseString,
    selectedLibraryEntry,
    selectedLibraryPoseString,
    shellMode,
    showConsole,
    showLabels,
    showPivots,
    systemLogs,
    targetFps,
    walkKeyPoseSet,
    gait,
  ]);

  const buildExportContext = useCallback(() => ({
    viewBox: STAGE_VIEW_BOX_STRING,
    groundY: STAGE_GROUND_Y,
    baseUnitH: DEFAULT_BASE_UNIT_H,
    gait,
    idleSettings,
    activePins: activePinsList,
    pivotOffsets,
    gravityCenter,
    keyPoseMode,
    keyPoseSet: walkKeyPoseSet,
    lotteSettings,
  }), [
    activePinsList,
    gait,
    gravityCenter,
    idleSettings,
    keyPoseMode,
    lotteSettings,
    pivotOffsets,
    walkKeyPoseSet,
  ]);

  const compiledKeyPoseSet = useMemo(() => (
    compileWalkKeyPoseSet(walkKeyPoseSet, generateBasePoseAtPhase)
  ), [generateBasePoseAtPhase, walkKeyPoseSet]);

  const generatePoseAtPhase = useCallback((phase: number) => {
    const basePose = generateBasePoseAtPhase(phase);
    if (!keyPoseMode) return basePose;
    return applyCompiledWalkKeyPoseOverlay(basePose, phase, compiledKeyPoseSet);
  }, [compiledKeyPoseSet, generateBasePoseAtPhase, keyPoseMode]);

  const requestExport = useCallback((mode: 'frames' | 'keyframes' | 'animated') => {
    if (exportLockRef.current || isExporting || pendingExport) return;
    exportLockRef.current = true;
    setIsExporting(true);
    setPendingExport({ mode });
  }, [isExporting, pendingExport]);

  useEffect(() => {
    if (!pendingExport) return;
    let cancelled = false;
    const context = buildExportContext();
    const shouldRestorePause = !isPausedRef.current;

    const run = async () => {
      if (shouldRestorePause) {
        setIsPaused(true);
      }

      try {
        if (pendingExport.mode === 'frames') {
          logSystem('Export: loop frames zip');
          await exportLoopFrames(context, generatePoseAtPhase, exportFps);
          if (!cancelled) logSystem('Export complete: frames zip');
        } else if (pendingExport.mode === 'keyframes') {
          logSystem('Export: keyframes zip');
          await exportKeyframes(context, generatePoseAtPhase);
          if (!cancelled) logSystem('Export complete: keyframes zip');
        } else {
          logSystem(`Export: animated ${exportFormat.toUpperCase()}`);
          const animatedExportFps = exportFormat === 'gif' ? Math.min(6, exportFps) : Math.min(12, exportFps);
          const animatedExportScale = exportFormat === 'gif' ? 0.45 : 0.7;
          await exportAnimatedLoop(context, generatePoseAtPhase, animatedExportFps, exportFormat, animatedExportScale);
          if (!cancelled) logSystem(`Export complete: animated ${exportFormat.toUpperCase()}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown export error';
        if (!cancelled) logSystem(`Export failed: ${message}`);
      } finally {
        if (!cancelled) {
          setIsExporting(false);
          setPendingExport(null);
          exportLockRef.current = false;
          if (shouldRestorePause) {
            setIsPaused(false);
          }
        } else {
          exportLockRef.current = false;
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [buildExportContext, exportFormat, exportFps, generatePoseAtPhase, pendingExport]);

  const selectedAnchorPhaseValue = phaseToPercent(selectedAnchor.phase);
  const cyclePreviewValue = phaseToPercent(keyPosePreviewPhase);
  const playbackButtonLabel = keyPoseEditorPlaying ? 'PAUSE' : 'PLAY';

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-shell text-ink xl:flex-row">
      <aside className="flex w-full min-w-0 flex-col border-b border-ridge bg-white/90 shadow-2xl backdrop-blur xl:w-[24rem] xl:border-b-0 xl:border-r">
        <div className="border-b border-ridge px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-archaic text-4xl uppercase tracking-[0.28em] text-ink">Bitruvian</div>
              <div className="mt-1 text-[8px] font-black uppercase tracking-[0.28em] text-mono-light">
                lean shell / current physics / live pose library
              </div>
            </div>
            <div className="rounded border border-ridge bg-shell px-2 py-1 text-[7px] font-black uppercase tracking-[0.22em] text-mono-mid">
              {shellMode.toUpperCase()}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <ToggleChip active={shellMode === 'runtime'} onClick={exitEditor}>
              Runtime
            </ToggleChip>
            <ToggleChip active={shellMode === 'editor'} onClick={() => enterEditorAtPhase(livePhaseRef.current ?? pose.stride_phase ?? 0)}>
              Editor
            </ToggleChip>
            <ToggleChip active={motionMode === 'locomotion'} onClick={() => setMotionMode('locomotion')}>
              Locomotion
            </ToggleChip>
            <ToggleChip active={motionMode === 'idle'} onClick={() => setMotionMode('idle')}>
              Idle
            </ToggleChip>
            <ToggleChip active={isPaused} onClick={handlePauseToggle}>
              {isPaused ? 'Running' : 'Pause'}
            </ToggleChip>
            <ToggleChip active={displayPivots} onClick={() => setShowPivots((prev) => !prev)}>
              Pivots
            </ToggleChip>
            <ToggleChip active={displayLabels} onClick={() => setShowLabels((prev) => !prev)}>
              Labels
            </ToggleChip>
            <ToggleChip active={showConsole} onClick={() => setShowConsole((prev) => !prev)}>
              Console
            </ToggleChip>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 custom-scrollbar">
          <Section title="Motion" count={gaitKeyGroups.core.length + gaitKeyGroups.advanced.length + gaitModeOptions.length + strideEntryOptions.length} defaultOpen>
            <div className="space-y-4">
              <div className="rounded border border-ridge bg-shell px-3 py-2">
                <div className="text-[7px] font-black uppercase tracking-[0.26em] text-mono-light">Motion Mode</div>
                <div className="text-[8px] font-black uppercase tracking-[0.2em] text-selection">{gaitModeRef.current.toUpperCase()}</div>
                <div className="mt-1 text-[7px] font-black uppercase tracking-[0.22em] text-mono-light">
                  Use the top bar to switch between locomotion and idle.
                </div>
              </div>

              <div className="grid grid-cols-5 gap-1.5">
                {gaitModeOptions.map((option) => {
                  const active = gaitModeRef.current === option.mode;
                  return (
                    <button
                      key={option.mode}
                      type="button"
                      onClick={() => updateGaitMode(option.mode)}
                      className={`rounded border px-2 py-2 text-left transition-all ${
                        active ? 'border-selection bg-selection text-white shadow-md' : 'border-ridge bg-white hover:bg-shell'
                      }`}
                    >
                      <div className="text-[8px] font-black tracking-[0.2em]">{option.label}</div>
                      <div className={`mt-1 text-[6px] uppercase tracking-[0.18em] ${active ? 'text-white/70' : 'text-mono-light'}`}>
                        {option.note}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-3 gap-1.5">
                {strideEntryOptions.map((option) => {
                  const active = strideEntryStyleRef.current === option.style;
                  return (
                    <button
                      key={option.style}
                      type="button"
                      onClick={() => updateStrideEntryStyle(option.style)}
                      className={`rounded border px-2 py-2 text-left transition-all ${
                        active ? 'border-selection bg-selection text-white shadow-md' : 'border-ridge bg-white hover:bg-shell'
                      }`}
                    >
                      <div className="text-[8px] font-black tracking-[0.2em]">{option.label}</div>
                      <div className={`mt-1 text-[6px] uppercase tracking-[0.18em] ${active ? 'text-white/70' : 'text-mono-light'}`}>
                        {option.note}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="space-y-3">
                {gaitKeyGroups.core.map((key) => {
                  const conf = gaitSliderConfig[key];
                  if (!conf) return null;
                  const strideBand = key === 'stride' ? STRIDE_BANDS[gaitModeRef.current] : null;
                  const displayValue = key === 'stride' ? mapStrideValueToPercent(gaitModeRef.current, gait[key]) : gait[key];

                  return (
                    <RangeControl
                      key={key}
                      label={conf.label}
                      value={key === 'stride' ? displayValue : gait[key]}
                      min={key === 'stride' && strideBand ? strideBand.uiMin : conf.min}
                      max={key === 'stride' && strideBand ? strideBand.uiMax : conf.max}
                      step={key === 'stride' ? 1 : conf.step}
                      onChange={(nextValue) => {
                        updateDisplayedGaitValue(key, key === 'stride' ? mapStridePercentToValue(gaitModeRef.current, nextValue) : nextValue);
                      }}
                      displayValue={key === 'stride' ? `${Math.round(displayValue)}%` : gait[key].toFixed(2)}
                      helper={key === 'stride' ? 'Walk 0-50 | Jog 50-75 | Run 75-100' : undefined}
                    />
                  );
                })}
              </div>

              <Section title="Advanced" defaultOpen={false} count={gaitKeyGroups.advanced.length}>
                <div className="space-y-3">
                  {gaitKeyGroups.advanced.map((key) => {
                    const conf = gaitSliderConfig[key];
                    if (!conf) return null;
                    return (
                      <RangeControl
                        key={key}
                        label={conf.label}
                        value={gait[key]}
                        min={conf.min}
                        max={conf.max}
                        step={conf.step}
                        onChange={(nextValue) => updateDisplayedGaitValue(key, nextValue)}
                        displayValue={gait[key].toFixed(2)}
                      />
                    );
                  })}
                </div>
              </Section>

              <Section title="Balance" defaultOpen={false} count={5}>
                <div className="space-y-3">
                  <div>
                    <div className="mb-2 text-[7px] font-black uppercase tracking-[0.24em] text-mono-light">Gravity Center</div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(['left', 'center', 'right'] as const).map((center) => (
                        <ToggleChip
                          key={center}
                          active={gravityCenter === center}
                          onClick={() => {
                            setGravityCenter(center);
                            logSystem(`Gravity center: ${center.toUpperCase()}`);
                          }}
                        >
                          {center}
                        </ToggleChip>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 text-[7px] font-black uppercase tracking-[0.24em] text-mono-light">Pins</div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {(['l_foot', 'r_foot'] as const).map((boneKey) => (
                        <ToggleChip
                          key={boneKey}
                          active={activePinsList.includes(boneKey)}
                          onClick={() => toggleAnchorPin(boneKey)}
                        >
                          {boneKey.replace('_', ' ')}
                        </ToggleChip>
                      ))}
                    </div>
                  </div>
                </div>
              </Section>
            </div>
          </Section>

          <Section title="Pose Library" count={POSE_LIBRARY_DB.length} defaultOpen>
            <div className="space-y-3">
              <div className="rounded border border-ridge bg-shell px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[7px] font-black uppercase tracking-[0.26em] text-mono-light">Selected Library</div>
                    <div className="text-[8px] font-black uppercase tracking-[0.2em] text-selection">
                      {selectedLibraryEntry.id} / {selectedLibraryEntry.name}
                    </div>
                  </div>
                  <ToggleChip
                    active={false}
                    onClick={applySelectedLibraryToSelectedAnchor}
                    disabled={!selectedLibraryEntry}
                  >
                    Seed Active Anchor
                  </ToggleChip>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-[7px] font-black uppercase tracking-[0.2em] text-mono-light">
                  <span>{selectedLibraryEntry.cat}</span>
                  <span>{selectedLibraryEntry.src}</span>
                  <span>{phaseToPercent(selectedLibraryEntry.phaseHint)}%</span>
                  {selectedLibraryEntry.mirrored && <span className="text-selection">Mirrored</span>}
                </div>
                <pre className="mt-2 max-h-20 overflow-y-auto rounded border border-ridge bg-white px-2 py-2 font-mono text-[6px] leading-snug text-mono-mid custom-scrollbar">
                  {selectedLibraryPoseString}
                </pre>
              </div>

              {selectedLibraryGroups.map((group) => (
                <div key={group.category} className="space-y-2">
                  <div className="flex items-center justify-between text-[7px] font-black uppercase tracking-[0.26em] text-mono-light">
                    <span>{group.category}</span>
                    <span>{group.entries.length}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {group.entries.map((entry) => {
                      const active = selectedLibraryEntry.id === entry.id;
                      return (
                        <button
                          key={entry.id}
                          type="button"
                          onClick={() => applyLibraryEntry(entry)}
                          className={`flex flex-col gap-1.5 rounded border p-2 text-left transition-all ${
                            active ? 'border-selection bg-selection text-white shadow-md' : 'border-ridge bg-white hover:bg-shell'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[8px] font-black tracking-[0.2em]">{entry.id}</span>
                            <span className={`rounded px-1.5 py-0.5 text-[6px] uppercase tracking-[0.18em] ${active ? 'bg-white/20 text-white' : 'bg-black/5 text-mono-light'}`}>
                              {entry.mirrored ? 'mirror' : entry.cat}
                            </span>
                          </div>
                          <div className="text-[8px] font-black uppercase tracking-[0.14em]">{entry.name}</div>
                          <div className={`text-[6px] uppercase tracking-[0.18em] ${active ? 'text-white/75' : 'text-mono-light'}`}>
                            {entry.src} · {phaseToPercent(entry.phaseHint)}%
                          </div>
                          <div className={`truncate font-mono text-[6px] leading-tight ${active ? 'text-white/85' : 'text-mono-mid'}`}>
                            {entry.data}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Key Poses" count={WALK_KEY_POSE_IDS.length} defaultOpen>
            <div className="space-y-3">
              <div className="rounded border border-ridge bg-shell px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[7px] font-black uppercase tracking-[0.26em] text-mono-light">Editor</div>
                    <div className={`text-[8px] font-black uppercase tracking-[0.2em] ${keyPoseMode ? 'text-selection' : 'text-mono-light'}`}>
                      {keyPoseMode ? (keyPoseEditorPlaying ? 'Live follow' : 'Frozen scrub') : 'Runtime only'}
                    </div>
                  </div>
                  <ToggleChip active={keyPoseEditorPlaying && keyPoseMode} onClick={toggleEditorPlayback} disabled={!keyPoseMode}>
                    {playbackButtonLabel}
                  </ToggleChip>
                </div>
                <div className="mt-2 text-[7px] font-black uppercase tracking-[0.2em] text-mono-light">
                  {keyPoseMode ? 'Editor mode forces labels and pivots on.' : 'Enter editor mode to scrub and author key poses.'}
                </div>
              </div>

              <RangeControl
                label="Cycle Preview"
                value={cyclePreviewValue}
                min={0}
                max={100}
                step={1}
                onChange={(nextValue) => {
                  if (!keyPoseMode || keyPoseEditorPlayingRef.current) return;
                  setKeyPosePreviewPhase(nextValue / 100);
                }}
                displayValue={`${cyclePreviewValue}%`}
                helper={keyPoseMode ? (keyPoseEditorPlaying ? 'LIVE' : 'SCRUB') : 'RUNTIME'}
                disabled={!keyPoseMode || keyPoseEditorPlaying}
              />

              <div className="grid grid-cols-2 gap-2">
                {WALK_KEY_POSE_IDS.map((anchorId) => {
                  const anchor = walkKeyPoseSet.anchors[anchorId];
                  const active = walkKeyPoseSet.selectedAnchorId === anchorId;
                  return (
                    <button
                      key={anchorId}
                      type="button"
                      onClick={() => setWalkKeyPoseSet((prev) => ({ ...prev, selectedAnchorId: anchorId }))}
                      className={`rounded border px-2 py-2 text-left transition-all ${
                        active ? 'border-selection bg-selection text-white shadow-md' : 'border-ridge bg-white hover:bg-shell'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[8px] font-black tracking-[0.2em] uppercase">{anchorId}</span>
                        <span className={`text-[6px] uppercase tracking-[0.18em] ${active ? 'text-white/75' : 'text-mono-light'}`}>
                          {phaseToPercent(anchor.phase)}%
                        </span>
                      </div>
                      <div className={`mt-1 text-[6px] uppercase tracking-[0.18em] ${active ? 'text-white/75' : 'text-mono-light'}`}>
                        {anchor.authored ? 'authored' : 'neutral'} · {anchor.mirror ? 'mirrored' : 'direct'}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="rounded border border-ridge bg-paper p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[7px] font-black uppercase tracking-[0.26em] text-mono-light">Selected Anchor</div>
                    <div className="text-[8px] font-black uppercase tracking-[0.2em] text-selection">
                      {selectedAnchor.id} · {phaseToPercent(selectedAnchor.phase)}%
                    </div>
                  </div>
                  <ToggleChip
                    active={selectedAnchor.mirror}
                    onClick={toggleSelectedAnchorMirror}
                    disabled={!keyPoseMode}
                  >
                    Mirror {selectedAnchor.mirror ? 'On' : 'Off'}
                  </ToggleChip>
                </div>

                <div className="mt-3 space-y-3">
                  <RangeControl
                    label="Anchor Phase"
                    value={selectedAnchorPhaseValue}
                    min={0}
                    max={100}
                    step={1}
                    onChange={(nextValue) => {
                      if (!keyPoseMode) return;
                      setWalkKeyPoseSet((prev) => setWalkKeyPosePhase(prev, prev.selectedAnchorId, nextValue / 100));
                    }}
                    displayValue={`${selectedAnchorPhaseValue}%`}
                    disabled={!keyPoseMode}
                  />

                  <div className="flex items-center gap-2">
                    <label className="flex flex-1 items-center gap-2 rounded border border-ridge bg-white px-2 py-2 text-[8px] font-black uppercase tracking-[0.18em]">
                      <span className="text-mono-light">Easing</span>
                      <select
                        value={selectedAnchor.easing}
                        onChange={(event) => {
                          if (!keyPoseMode) return;
                          const next = event.target.value as EasingType;
                          setWalkKeyPoseSet((prev) => setWalkKeyPoseEasing(prev, prev.selectedAnchorId, next));
                        }}
                        disabled={!keyPoseMode}
                        className="ml-auto bg-transparent text-selection outline-none disabled:cursor-not-allowed"
                      >
                        {WALK_KEY_POSE_EASING_OPTIONS.map((easing) => (
                          <option key={easing} value={easing}>
                            {easing}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={captureSelectedAnchor}
                      disabled={!keyPoseMode}
                      className="rounded border border-selection bg-selection px-3 py-2 text-[8px] font-black uppercase tracking-[0.18em] text-white transition-all hover:bg-selection-light disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Capture Current
                    </button>
                    <button
                      type="button"
                      onClick={resetSelectedAnchor}
                      disabled={!keyPoseMode}
                      className="rounded border border-selection bg-white px-3 py-2 text-[8px] font-black uppercase tracking-[0.18em] text-ink transition-all hover:bg-shell disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Reset Anchor
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={resetWalkKeyPoseSet}
                      disabled={!keyPoseMode}
                      className="rounded border border-ridge bg-white px-3 py-2 text-[8px] font-black uppercase tracking-[0.18em] text-ink transition-all hover:bg-shell disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Reset Set
                    </button>
                    <button
                      type="button"
                      onClick={applySelectedLibraryToSelectedAnchor}
                      className="rounded border border-selection bg-selection px-3 py-2 text-[8px] font-black uppercase tracking-[0.18em] text-white transition-all hover:bg-selection-light"
                    >
                      Seed Library
                    </button>
                  </div>

                  <pre className="max-h-24 overflow-y-auto rounded border border-ridge bg-white px-2 py-2 font-mono text-[6px] leading-snug text-mono-mid custom-scrollbar">
                    {selectedAnchorPoseString}
                  </pre>
                </div>
              </div>
            </div>
          </Section>

          <Section title="Idle" count={8} defaultOpen={false}>
            <div className="space-y-3">
              <RangeControl
                label="Breathing"
                value={idleSettings.breathing}
                min={0}
                max={1}
                step={0.01}
                onChange={(nextValue) => setIdleSettings((prev) => ({ ...prev, breathing: nextValue }))}
                displayValue={idleSettings.breathing.toFixed(2)}
              />
              <RangeControl
                label="Weight Shift"
                value={idleSettings.weightShift}
                min={0}
                max={1}
                step={0.01}
                onChange={(nextValue) => setIdleSettings((prev) => ({ ...prev, weightShift: nextValue }))}
                displayValue={idleSettings.weightShift.toFixed(2)}
              />
              <RangeControl
                label="Gaze Sway"
                value={idleSettings.gazeSway}
                min={0}
                max={1}
                step={0.01}
                onChange={(nextValue) => setIdleSettings((prev) => ({ ...prev, gazeSway: nextValue }))}
                displayValue={idleSettings.gazeSway.toFixed(2)}
              />
              <RangeControl
                label="Tension"
                value={idleSettings.tension}
                min={0}
                max={1}
                step={0.01}
                onChange={(nextValue) => setIdleSettings((prev) => ({ ...prev, tension: nextValue }))}
                displayValue={idleSettings.tension.toFixed(2)}
              />
              <RangeControl
                label="Fidget Frequency"
                value={idleSettings.fidgetFrequency}
                min={0}
                max={1}
                step={0.01}
                onChange={(nextValue) => setIdleSettings((prev) => ({ ...prev, fidgetFrequency: nextValue }))}
                displayValue={idleSettings.fidgetFrequency.toFixed(2)}
              />
              <RangeControl
                label="Transition Speed"
                value={idleSettings.transitionSpeed}
                min={0}
                max={1}
                step={0.01}
                onChange={(nextValue) => setIdleSettings((prev) => ({ ...prev, transitionSpeed: nextValue }))}
                displayValue={idleSettings.transitionSpeed.toFixed(2)}
              />
              <RangeControl
                label="Posture"
                value={idleSettings.posture}
                min={-1}
                max={1}
                step={0.01}
                onChange={(nextValue) => setIdleSettings((prev) => ({ ...prev, posture: nextValue }))}
                displayValue={idleSettings.posture.toFixed(2)}
              />
              <label className="flex items-center gap-2 rounded border border-ridge bg-white px-2 py-2 text-[8px] font-black uppercase tracking-[0.18em]">
                <span className="text-mono-light">Pinned Feet</span>
                <select
                  value={idleSettings.idlePinnedFeet}
                  onChange={(event) => setIdleSettings((prev) => ({ ...prev, idlePinnedFeet: event.target.value as IdleSettings['idlePinnedFeet'] }))}
                  className="ml-auto bg-transparent text-selection outline-none"
                >
                  <option value="none">none</option>
                  <option value="left">left</option>
                  <option value="right">right</option>
                  <option value="both">both</option>
                </select>
              </label>
            </div>
          </Section>

          <Section title="Export" count={3} defaultOpen>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => requestExport('frames')}
                  disabled={isExporting || Boolean(pendingExport)}
                  className="rounded border border-selection bg-white px-3 py-2 text-[8px] font-black uppercase tracking-[0.18em] text-ink transition-all hover:bg-shell disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Loop Frames ZIP
                </button>
                <button
                  type="button"
                  onClick={() => requestExport('keyframes')}
                  disabled={isExporting || Boolean(pendingExport)}
                  className="rounded border border-selection bg-white px-3 py-2 text-[8px] font-black uppercase tracking-[0.18em] text-ink transition-all hover:bg-shell disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Keyframes ZIP
                </button>
              </div>

              <div className="flex items-center gap-2">
                <label className="flex flex-1 items-center gap-2 rounded border border-ridge bg-white px-2 py-2 text-[8px] font-black uppercase tracking-[0.18em]">
                  <span className="text-mono-light">Animated</span>
                  <select
                    value={exportFormat}
                    onChange={(event) => setExportFormat(event.target.value as AnimatedExportFormat)}
                    className="ml-auto bg-transparent text-selection outline-none"
                  >
                    <option value="gif">GIF</option>
                    <option value="webm">WebM</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => requestExport('animated')}
                  disabled={isExporting || Boolean(pendingExport)}
                  className="rounded border border-selection bg-selection px-3 py-2 text-[8px] font-black uppercase tracking-[0.18em] text-white transition-all hover:bg-selection-light disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isExporting ? 'Exporting' : 'Export'}
                </button>
              </div>

              <RangeControl
                label="Runtime FPS"
                value={targetFps}
                min={24}
                max={120}
                step={1}
                onChange={(nextValue) => setTargetFps(nextValue)}
                displayValue={`${Math.round(targetFps)} fps`}
                helper={`Export caps at ${exportFps} fps`}
              />

              <div className="text-[8px] uppercase leading-snug tracking-[0.18em] text-mono-light">
                Exports use the current key-pose set when the editor is open.
              </div>
            </div>
          </Section>

          {showConsole && <SystemLogger logs={systemLogs} isVisible={showConsole} />}
        </div>
      </aside>

      <main
        className="relative min-h-[24rem] min-w-0 flex-1 overflow-hidden"
        style={{
          backgroundImage: 'radial-gradient(circle at top, rgba(17, 24, 39, 0.08), transparent 38%), linear-gradient(180deg, #f8fafc 0%, #eef2f7 100%)',
        }}
      >
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox={STAGE_VIEW_BOX_STRING}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Bitruvian mannequin stage"
        >
          <defs>
            <pattern id="stage-grid" width={STAGE_GRID_SIZE} height={STAGE_GRID_SIZE} patternUnits="userSpaceOnUse">
              <path d={`M ${STAGE_GRID_SIZE} 0 L 0 0 0 ${STAGE_GRID_SIZE}`} fill="none" stroke="rgba(17, 24, 39, 0.08)" strokeWidth="1" />
            </pattern>
          </defs>

          <rect x={STAGE_VIEW_BOX.x} y={STAGE_VIEW_BOX.y} width={STAGE_VIEW_BOX.width} height={STAGE_VIEW_BOX.height} fill="url(#stage-grid)" opacity="0.65" />
          <AdvancedGrid origin={{ x: 0, y: 0 }} gridSize={STAGE_GRID_SIZE} viewBox={STAGE_VIEW_BOX} />
          <SystemGuides floorY={STAGE_GROUND_Y} baseUnitH={DEFAULT_BASE_UNIT_H} />

          <g transform={`translate(${pose.x_offset}, ${STAGE_GROUND_Y - (MANNEQUIN_LOCAL_FLOOR_Y * DEFAULT_BASE_UNIT_H) + pose.y_offset})`}>
            <Mannequin
              pose={pose}
              bodyRotation={pose.bodyRotation ?? 0}
              pivotOffsets={pivotOffsets}
              props={proportions}
              showPivots={displayPivots}
              showLabels={displayLabels}
              baseUnitH={DEFAULT_BASE_UNIT_H}
              onAnchorMouseDown={(boneKey) => handleAnchorMouseDown(boneKey)}
              draggingBoneKey={null}
              isPaused={isPaused}
              activePins={activePinsList}
              tensions={tensions}
              jointModes={{}}
              lotteSettings={lotteSettings}
              isExploded={keyPoseMode}
            />
          </g>
        </svg>

        <Scanlines />

        <div className="pointer-events-none absolute left-4 top-4 z-20 flex flex-col gap-2">
          <div className="rounded-full border border-ridge bg-white/85 px-3 py-1.5 text-[7px] font-black uppercase tracking-[0.26em] text-mono-mid shadow-sm backdrop-blur">
            {shellMode.toUpperCase()} · {motionMode.toUpperCase()} · {keyPoseEditorPlaying && keyPoseMode ? 'LIVE' : keyPoseMode ? 'SCRUB' : 'RUN'}
          </div>
          <div className="rounded border border-ridge bg-white/85 px-3 py-1.5 text-[7px] font-black uppercase tracking-[0.24em] text-mono-mid shadow-sm backdrop-blur">
            anchor {walkKeyPoseSet.selectedAnchorId.toUpperCase()} · {selectedLibraryEntry.name} · {phaseToPercent(pose.stride_phase ?? 0)}%
          </div>
        </div>

        <div className="pointer-events-none absolute right-4 top-4 z-20 flex flex-col items-end gap-2">
          <div className="rounded border border-ridge bg-white/85 px-3 py-1.5 text-right text-[7px] font-black uppercase tracking-[0.24em] text-mono-mid shadow-sm backdrop-blur">
            {displayLabels ? 'labels on' : 'labels off'} · {displayPivots ? 'pivots on' : 'pivots off'}
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;
