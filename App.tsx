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
import { useMannequinStore } from './store';
import {
  GaitMode,
  IdleSettings,
  JointModesState,
  WalkingEngineGait,
  WalkingEnginePivotOffsets,
  WalkingEnginePose,
} from './types';
import {
  applyJointCascade,
  formatJointLabel,
  JOINT_KEYS,
  POSE_BODY_ROTATION_MAX,
  POSE_BODY_ROTATION_MIN,
  POSE_DRAG_SENSITIVITY,
  POSE_JOINT_SLIDER_MAX,
  POSE_JOINT_SLIDER_MIN,
  toggleJointMode,
} from './utils/poserAuthoring';

const DEFAULT_BASE_UNIT_H = 150;
const STAGE_VIEW_BOX = UI.BASE_VIEWBOX;
const STAGE_VIEW_BOX_STRING = `${STAGE_VIEW_BOX.x} ${STAGE_VIEW_BOX.y} ${STAGE_VIEW_BOX.width} ${STAGE_VIEW_BOX.height}`;
const STAGE_GROUND_Y = UI.BASE_VIEWBOX.y + UI.BASE_VIEWBOX.height - 4;
const STAGE_GRID_SIZE = 120;

type ShellMode = 'runtime';
type StrideEntryStyle = 'tiptoe' | 'neutral' | 'drive';
type WorkspaceMode = 'motion' | 'poser';

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

const ANIMATED_EXPORT_FPS_OPTIONS = [6, 12, 15, 24, 30, 60] as const;

const gaitModeOptions: { mode: GaitMode; label: string; note: string }[] = [
  {
    mode: 'idle',
    label: 'IDLE',
    note: 'planted stance',
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
];

const STRIDE_BANDS: Record<GaitMode, { uiMin: number; uiMax: number; actualMin: number; actualMax: number }> = {
  idle: { uiMin: 0, uiMax: 50, actualMin: 0.12, actualMax: 0.65 },
  walk: { uiMin: 0, uiMax: 50, actualMin: 0.12, actualMax: 0.65 },
  jog: { uiMin: 50, uiMax: 75, actualMin: 0.65, actualMax: 1.22 },
  run: { uiMin: 75, uiMax: 100, actualMin: 1.22, actualMax: 1.95 },
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

const normalizePhase = (phase: number): number => ((phase % 1) + 1) % 1;

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
    setPivotOffsets,
    setActivePins,
    setGravityCenter,
  } = useMannequinStore();

  const shellMode: ShellMode = 'runtime';
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('motion');
  const [showPivots, setShowPivots] = useState(true);
  const [showLabels, setShowLabels] = useState(false);
  const [showConsole, setShowConsole] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [poserMotionEnabled, setPoserMotionEnabled] = useState(true);
  const [targetFps, setTargetFps] = useState(TIMING.DEFAULT_TARGET_FPS);
  const [exportFormat, setExportFormat] = useState<AnimatedExportFormat>('gif');
  const [animatedExportFps, setAnimatedExportFps] = useState<number>(24);
  const [showAnimatedExportPicker, setShowAnimatedExportPicker] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [pendingExport, setPendingExport] = useState<{ mode: 'frames' | 'keyframes' | 'animated' } | null>(null);
  const [poserBodyRotation, setPoserBodyRotation] = useState(0);
  const [jointModes, setJointModes] = useState<JointModesState>({});
  const [draggingBoneKey, setDraggingBoneKey] = useState<keyof WalkingEnginePivotOffsets | null>(null);
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
  const [zoomIndex, setZoomIndex] = useState(UI.DEFAULT_ZOOM_INDEX);

  const activePinsList = Array.isArray(activePins) ? activePins : [];
  const displayLabels = showLabels;
  const displayPivots = showPivots;
  const exportFps = Math.min(24, targetFps);
  const displayedPose = useMemo<WalkingEnginePose>(() => ({
    ...pose,
    bodyRotation: (pose.bodyRotation ?? 0) + poserBodyRotation,
  }), [pose, poserBodyRotation]);

  const zoom = UI.ZOOM_LEVELS[zoomIndex];
  const zoomedViewBox = useMemo(() => {
    const z = zoom;
    const newWidth = STAGE_VIEW_BOX.width / z;
    const newHeight = STAGE_VIEW_BOX.height / z;
    const stageBottomY = STAGE_VIEW_BOX.y + STAGE_VIEW_BOX.height;
    const newX = STAGE_VIEW_BOX.x - (newWidth - STAGE_VIEW_BOX.width) / 2;
    const newY = stageBottomY - newHeight;
    return { x: newX, y: newY, width: newWidth, height: newHeight };
  }, [zoom]);

  const locomotionStateRef = useRef<LocomotionState>({ ...INITIAL_LOCOMOTION_STATE });
  const lastFrameTimeRef = useRef(0);
  const locomotionWeightRef = useRef(1.0);
  const gaitModeRef = useRef<GaitMode>('walk');
  const strideEntryStyleRef = useRef<StrideEntryStyle>('tiptoe');
  const gaitBaseRef = useRef<WalkingEngineGait>(normalizeGaitModeEnvelope(gait, gaitModeRef.current));
  const isPausedRef = useRef(isPaused);
  const exportLockRef = useRef(false);
  const poserShowPivotsBeforeRef = useRef(showPivots);
  const dragStartXRef = useRef(0);
  const dragStartValueRef = useRef(0);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  const logSystem = useCallback((message: string) => {
    setSystemLogs((prev) => [...prev.slice(-23), { timestamp: new Date().toLocaleTimeString(), message }]);
  }, []);

  const generateBasePoseAtPhase = useCallback((phase: number) => {
    const p = normalizePhase(phase) * Math.PI * 2;
    const locPose = updateLocomotionPhysics(p, { ...INITIAL_LOCOMOTION_STATE }, gait, physics, 1.0);
    const grounded = applyFootGrounding(locPose, proportions, DEFAULT_BASE_UNIT_H, physics, activePinsList, idleSettings, gravityCenter, 1.0, 16);
    return grounded.adjustedPose as WalkingEnginePose;
  }, [activePinsList, gait, gravityCenter, idleSettings, physics, proportions]);

  const generateIdlePoseAtPhase = useCallback((phase: number) => {
    const syntheticTime = phase * 10_000;
    return updateIdlePhysics(syntheticTime, 16, idleSettings, 0, [], true) as WalkingEnginePose;
  }, [idleSettings]);

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

  const toggleWorkspaceMode = useCallback(() => {
    setWorkspaceMode((prev) => {
      if (prev === 'poser') {
        setShowPivots(poserShowPivotsBeforeRef.current);
        setDraggingBoneKey(null);
        logSystem('Workspace: MOTION');
        return 'motion';
      }

      poserShowPivotsBeforeRef.current = showPivots;
      setShowPivots(true);
      logSystem('Workspace: POSER');
      return 'poser';
    });
  }, [logSystem, showPivots]);

  const handleJointModeChange = useCallback((key: keyof WalkingEnginePivotOffsets, mode: 'bend' | 'stretch') => {
    setJointModes((prev) => toggleJointMode(prev, key, mode));
    logSystem(`Joint mode: ${formatJointLabel(key)} → ${mode.toUpperCase()}`);
  }, [logSystem]);

  const handlePoserPivotChange = useCallback((key: keyof WalkingEnginePivotOffsets, nextValue: number) => {
    setPivotOffsets((prev) => applyJointCascade(prev, key, nextValue, jointModes));
  }, [jointModes, setPivotOffsets]);

  const handleBoneMouseDown = useCallback((boneKey: keyof WalkingEnginePivotOffsets, clientX: number, event: React.MouseEvent) => {
    const canEditBones = workspaceMode === 'poser' || (isPaused && showPivots);
    if (!canEditBones) return;

    event.preventDefault();
    event.stopPropagation();

    if (event.shiftKey) {
      setActivePins((prev) => {
        const next = prev.includes(boneKey) ? prev.filter((key) => key !== boneKey) : [...prev, boneKey];
        logSystem(`Pin: ${boneKey.toUpperCase()} ${next.includes(boneKey) ? 'ON' : 'OFF'}`);
        return next;
      });
      return;
    }

    setDraggingBoneKey(boneKey);
    dragStartXRef.current = clientX;
    dragStartValueRef.current = pivotOffsets[boneKey];
  }, [isPaused, logSystem, pivotOffsets, setActivePins, showPivots, workspaceMode]);

  const handleGlobalBoneMouseMove = useCallback((event: MouseEvent) => {
    if (!draggingBoneKey) return;

    const deltaX = event.clientX - dragStartXRef.current;
    const nextValue = clamp(
      dragStartValueRef.current + (deltaX * POSE_DRAG_SENSITIVITY),
      POSE_JOINT_SLIDER_MIN,
      POSE_JOINT_SLIDER_MAX,
    );

    setPivotOffsets((prev) => applyJointCascade(prev, draggingBoneKey, nextValue, jointModes));
  }, [draggingBoneKey, jointModes, setPivotOffsets]);

  const handleGlobalBoneMouseUp = useCallback(() => {
    setDraggingBoneKey(null);
  }, []);

  useEffect(() => {
    if (!draggingBoneKey) return;

    window.addEventListener('mousemove', handleGlobalBoneMouseMove);
    window.addEventListener('mouseup', handleGlobalBoneMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleGlobalBoneMouseMove);
      window.removeEventListener('mouseup', handleGlobalBoneMouseUp);
    };
  }, [draggingBoneKey, handleGlobalBoneMouseMove, handleGlobalBoneMouseUp]);

  const handlePauseToggle = useCallback(() => {
    setIsPaused((prev) => !prev);
  }, []);

  useEffect(() => {
    let frame = 0;

    const applyFrame = (time: number, elapsed: number) => {
      const isIdleMode = gaitModeRef.current === 'idle';
      const targetWeight = isIdleMode ? 0.0 : 1.0;
      locomotionWeightRef.current = lerp(locomotionWeightRef.current, targetWeight, 0.08);
      const locWeight = locomotionWeightRef.current;

      if (isIdleMode) {
        const idlePose = updateIdlePhysics(time, elapsed, idleSettings, 0, [], true);
        const grounded = applyFootGrounding(idlePose, proportions, DEFAULT_BASE_UNIT_H, physics, activePinsList, idleSettings, gravityCenter, 0, elapsed);
        setTensions(grounded.tensions);
        setGroundingState(grounded.footState ?? null);
        setPose(grounded.adjustedPose as WalkingEnginePose);
        return;
      }

      const p = (time * 0.005 * gait.frequency) % (Math.PI * 2);
      const locPoseBase = updateLocomotionPhysics(p, locomotionStateRef.current, gait, physics, locWeight);
      const idlePose = updateIdlePhysics(time, elapsed, idleSettings, locWeight, []);
      const blendedPose = BehaviorEngine.blendPose(locPoseBase, idlePose, {}, locWeight, gait, time);
      const grounded = applyFootGrounding(blendedPose, proportions, DEFAULT_BASE_UNIT_H, physics, activePinsList, idleSettings, gravityCenter, locWeight, elapsed);
      setTensions(grounded.tensions);
      setGroundingState(grounded.footState ?? null);
      setPose(grounded.adjustedPose as WalkingEnginePose);
    };

    const animate = (time: number) => {
      frame = window.requestAnimationFrame(animate);

      if (isPausedRef.current || (workspaceMode === 'poser' && !poserMotionEnabled)) {
        lastFrameTimeRef.current = time;
        return;
      }

      const elapsed = time - lastFrameTimeRef.current;
      if (elapsed < 1000 / targetFps) return;
      lastFrameTimeRef.current = time;

      applyFrame(time, elapsed);
    };

    const advanceTime = (ms: number) => {
      const steps = Math.max(1, Math.round(ms / (1000 / 60)));
      const stepMs = ms / steps;
      let syntheticTime = lastFrameTimeRef.current;

      for (let i = 0; i < steps; i += 1) {
        syntheticTime += stepMs;
        lastFrameTimeRef.current = syntheticTime;
        applyFrame(syntheticTime, stepMs);
      }
    };

    const windowTarget = window as Window & { advanceTime?: (ms: number) => void };
    windowTarget.advanceTime = advanceTime;

    frame = window.requestAnimationFrame(animate);
    return () => {
      window.cancelAnimationFrame(frame);
      if (windowTarget.advanceTime === advanceTime) delete windowTarget.advanceTime;
    };
  }, [
    activePinsList,
    gait,
    gravityCenter,
    idleSettings,
    physics,
    proportions,
    poserMotionEnabled,
    setPose,
    targetFps,
    workspaceMode,
  ]);

  useEffect(() => {
    const renderGameToText = () => JSON.stringify({
      shellMode,
      workspaceMode,
      motionMode: gaitModeRef.current === 'idle' ? 'idle' : 'locomotion',
      gaitMode: gaitModeRef.current,
      paused: isPaused,
      showLabels,
      showPivots,
      showConsole,
      targetFps,
      exportFormat,
      pose: {
        bodyRotation: displayedPose.bodyRotation,
        waist: displayedPose.waist,
        torso: displayedPose.torso,
        collar: displayedPose.collar,
        neck: displayedPose.neck,
        lShoulder: displayedPose.l_shoulder,
        rShoulder: displayedPose.r_shoulder,
        lElbow: displayedPose.l_elbow,
        rElbow: displayedPose.r_elbow,
        lHand: displayedPose.l_hand,
        rHand: displayedPose.r_hand,
        lHip: displayedPose.l_hip,
        rHip: displayedPose.r_hip,
        lKnee: displayedPose.l_knee,
        rKnee: displayedPose.r_knee,
        lFoot: displayedPose.l_foot,
        rFoot: displayedPose.r_foot,
        xOffset: displayedPose.x_offset,
        yOffset: displayedPose.y_offset,
        stridePhase: displayedPose.stride_phase,
      },
      poser: {
        active: workspaceMode === 'poser',
        bodyRotationOffset: poserBodyRotation,
        draggingBoneKey,
        jointModes,
        pivotOffsets,
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
    pendingExport?.mode,
    pose,
    shellMode,
    showConsole,
    showLabels,
    showPivots,
    systemLogs,
    targetFps,
    gait,
    displayedPose,
    workspaceMode,
    poserBodyRotation,
    draggingBoneKey,
    jointModes,
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
    lotteSettings,
    workspaceMode,
    poserBodyRotation,
    jointModes,
  }), [
    activePinsList,
    gait,
    gravityCenter,
    idleSettings,
    lotteSettings,
    pivotOffsets,
    workspaceMode,
    poserBodyRotation,
    jointModes,
  ]);

  const generatePoseAtPhase = useCallback((phase: number) => {
    return gaitModeRef.current === 'idle'
      ? generateIdlePoseAtPhase(phase)
      : generateBasePoseAtPhase(phase);
  }, [generateBasePoseAtPhase, generateIdlePoseAtPhase]);

  const generatePosedPoseAtPhase = useCallback((phase: number) => {
    const basePose = generatePoseAtPhase(phase);
    return {
      ...basePose,
      bodyRotation: (basePose.bodyRotation ?? 0) + poserBodyRotation,
    };
  }, [generatePoseAtPhase, poserBodyRotation]);

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
          await exportLoopFrames(context, generatePosedPoseAtPhase, exportFps);
          if (!cancelled) logSystem('Export complete: frames zip');
        } else if (pendingExport.mode === 'keyframes') {
          logSystem('Export: keyframes zip');
          await exportKeyframes(context, generatePosedPoseAtPhase);
          if (!cancelled) logSystem('Export complete: keyframes zip');
        } else {
          logSystem(`Export: animated ${exportFormat.toUpperCase()}`);
          const animatedExportScale = exportFormat === 'gif' ? 0.45 : 0.7;
          await exportAnimatedLoop(context, generatePosedPoseAtPhase, animatedExportFps, exportFormat, animatedExportScale);
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
  }, [animatedExportFps, buildExportContext, exportFormat, generatePosedPoseAtPhase, pendingExport]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-shell text-ink xl:flex-row">
      <main
        className="relative order-1 min-h-[56svh] min-w-0 flex-[0_0_auto] overflow-hidden xl:order-2 xl:min-h-0 xl:flex-1"
        style={{
          backgroundImage: 'radial-gradient(circle at top, rgba(17, 24, 39, 0.08), transparent 38%), linear-gradient(180deg, #f8fafc 0%, #eef2f7 100%)',
        }}
      >
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox={`${zoomedViewBox.x} ${zoomedViewBox.y} ${zoomedViewBox.width} ${zoomedViewBox.height}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Bitruvius mannequin stage"
        >
          <defs>
            <pattern id="stage-grid" width={STAGE_GRID_SIZE} height={STAGE_GRID_SIZE} patternUnits="userSpaceOnUse">
              <path d={`M ${STAGE_GRID_SIZE} 0 L 0 0 0 ${STAGE_GRID_SIZE}`} fill="none" stroke="rgba(17, 24, 39, 0.08)" strokeWidth="1" />
            </pattern>
          </defs>

          <rect x={zoomedViewBox.x} y={zoomedViewBox.y} width={zoomedViewBox.width} height={zoomedViewBox.height} fill="url(#stage-grid)" opacity="0.65" />
          <AdvancedGrid origin={{ x: 0, y: 0 }} gridSize={STAGE_GRID_SIZE} viewBox={zoomedViewBox} />
          <SystemGuides floorY={STAGE_GROUND_Y} baseUnitH={DEFAULT_BASE_UNIT_H} />

          <g transform={`translate(${pose.x_offset}, ${STAGE_GROUND_Y - (MANNEQUIN_LOCAL_FLOOR_Y * DEFAULT_BASE_UNIT_H) + pose.y_offset})`}>
            <Mannequin
              pose={displayedPose}
              bodyRotation={displayedPose.bodyRotation ?? 0}
              pivotOffsets={pivotOffsets}
              props={proportions}
              showPivots={displayPivots}
              showLabels={displayLabels}
              baseUnitH={DEFAULT_BASE_UNIT_H}
              onAnchorMouseDown={handleBoneMouseDown}
              onBodyMouseDown={handleBoneMouseDown}
              draggingBoneKey={draggingBoneKey}
              isPaused={isPaused}
              poserActive={workspaceMode === 'poser'}
              activePins={activePinsList}
              tensions={tensions}
              jointModes={jointModes}
              lotteSettings={lotteSettings}
              isExploded={false}
            />
          </g>
        </svg>

        <Scanlines />

        <div className="pointer-events-none absolute left-4 top-4 z-20 hidden flex-col gap-2 xl:flex">
          <div className="rounded-full border border-ridge bg-white/85 px-3 py-1.5 text-[7px] font-black uppercase tracking-[0.26em] text-mono-mid shadow-sm backdrop-blur">
            {shellMode.toUpperCase()} · {workspaceMode.toUpperCase()} · {gaitModeRef.current.toUpperCase()} · {isPaused ? 'PAUSED' : 'LIVE'}
          </div>
          <div className="rounded border border-ridge bg-white/85 px-3 py-1.5 text-[7px] font-black uppercase tracking-[0.24em] text-mono-mid shadow-sm backdrop-blur">
            gait {gaitModeRef.current.toUpperCase()} · phase {phaseToPercent(displayedPose.stride_phase ?? 0)}% · pins {activePinsList.length}
          </div>
        </div>

        <div className="pointer-events-none absolute right-4 top-4 z-20 hidden flex-col items-end gap-2 xl:flex">
          <div className="rounded border border-ridge bg-white/85 px-3 py-1.5 text-right text-[7px] font-black uppercase tracking-[0.24em] text-mono-mid shadow-sm backdrop-blur">
            {displayLabels ? 'labels on' : 'labels off'} · {displayPivots ? 'pivots on' : 'pivots off'}
          </div>
        </div>

        <div className="pointer-events-auto absolute bottom-4 right-4 z-20 flex flex-col gap-1">
          <button
            type="button"
            onClick={() => setZoomIndex(i => Math.min(UI.ZOOM_LEVELS.length - 1, i + 1))}
            className="rounded border border-ridge bg-white/90 px-2 py-1 text-[8px] font-black uppercase tracking-[0.24em] text-ink hover:bg-shell shadow-sm backdrop-blur"
          >
            ZOOM +
          </button>
          <div className="rounded border border-ridge bg-white/90 px-2 py-1 text-center text-[7px] font-black uppercase tracking-[0.24em] text-mono-mid shadow-sm backdrop-blur">
            {zoom.toFixed(2)}x
          </div>
          <button
            type="button"
            onClick={() => setZoomIndex(i => Math.max(0, i - 1))}
            className="rounded border border-ridge bg-white/90 px-2 py-1 text-[8px] font-black uppercase tracking-[0.24em] text-ink hover:bg-shell shadow-sm backdrop-blur"
          >
            ZOOM -
          </button>
        </div>
      </main>

      <aside className="order-2 flex max-h-[44svh] w-full min-w-0 flex-col overflow-hidden border-t border-ridge bg-white/90 shadow-2xl backdrop-blur xl:order-1 xl:h-full xl:max-h-none xl:w-[24rem] xl:border-t-0 xl:border-r">
        <div className="border-b border-ridge px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-archaic text-4xl uppercase tracking-[0.28em] text-ink">Bitruvius</div>
              <div className="mt-1 text-[8px] font-black uppercase tracking-[0.28em] text-mono-light">
                The Bitruvian Posyng Puppyt.
              </div>
            </div>
            <div className="rounded border border-ridge bg-shell px-2 py-1 text-[7px] font-black uppercase tracking-[0.22em] text-mono-mid">
              {shellMode.toUpperCase()}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <div className="rounded-full border border-ridge bg-white px-3 py-1.5 text-[8px] font-black uppercase tracking-[0.24em] text-ink">
              Runtime
            </div>
            <ToggleChip active={isPaused} onClick={handlePauseToggle}>
              {isPaused ? 'Running' : 'Pause'}
            </ToggleChip>
            <ToggleChip active={displayPivots} onClick={() => setShowPivots((prev) => !prev)} disabled={workspaceMode === 'poser'} title={workspaceMode === 'poser' ? 'Poser forces pivots visible' : 'Toggle joint pivots'}>
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
          <Section title="Shared" count={gaitModeOptions.length + 2} defaultOpen>
            <div className="space-y-3">
              <ToggleChip
                active={poserMotionEnabled}
                onClick={() => setPoserMotionEnabled((prev) => !prev)}
              >
                {poserMotionEnabled ? 'Motion On' : 'Motion Off'}
              </ToggleChip>

              <div className="rounded border border-ridge bg-shell px-3 py-2">
                <div className="text-[7px] font-black uppercase tracking-[0.26em] text-mono-light">Workspace / Balance</div>
                <div className="text-[8px] font-black uppercase tracking-[0.2em] text-selection">
                  {workspaceMode.toUpperCase()} · {gaitModeRef.current.toUpperCase()}
                </div>
                <div className="mt-1 text-[7px] font-black uppercase tracking-[0.22em] text-mono-light">
                  Shared controls work across gait motion and the live poser overlay.
                </div>
              </div>

              <div className="grid grid-cols-5 gap-1.5">
                <button
                  type="button"
                  onClick={toggleWorkspaceMode}
                  className={`rounded border px-2 py-2 text-left transition-all ${
                    workspaceMode === 'poser' ? 'border-selection bg-selection text-white shadow-md' : 'border-ridge bg-white hover:bg-shell'
                  }`}
                >
                  <div className="text-[8px] font-black tracking-[0.2em]">POSER</div>
                  <div className={`mt-1 text-[6px] uppercase tracking-[0.18em] ${workspaceMode === 'poser' ? 'text-white/70' : 'text-mono-light'}`}>
                    live overlay
                  </div>
                </button>
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
              </div>
            </div>
          </Section>

          <Section title="Poser" count={JOINT_KEYS.length + 1} defaultOpen>
            <div className="space-y-3">
              <div className="rounded border border-ridge bg-shell px-3 py-2">
                <div className="text-[7px] font-black uppercase tracking-[0.26em] text-mono-light">Joint Authoring</div>
                <div className="text-[8px] font-black uppercase tracking-[0.2em] text-selection">
                  {workspaceMode === 'poser' ? 'ACTIVE' : 'READY'}
                </div>
                <div className="mt-1 text-[7px] font-black uppercase tracking-[0.22em] text-mono-light">
                  Click a bone body or pivot dot to drag rotation. Shift-click pins.
                </div>
              </div>

              <RangeControl
                label="Body Rotation"
                value={poserBodyRotation}
                min={POSE_BODY_ROTATION_MIN}
                max={POSE_BODY_ROTATION_MAX}
                step={1}
                onChange={(nextValue) => setPoserBodyRotation(nextValue)}
                displayValue={`${Math.round(poserBodyRotation)}°`}
                helper={poserMotionEnabled ? 'Live overlay on top of the procedural body rotation.' : 'Static pose overlay while motion is frozen.'}
              />

              <div className="space-y-3 max-h-[28rem] overflow-y-auto pr-1 custom-scrollbar">
                {JOINT_KEYS.map((key) => {
                  const currentMode = jointModes[key] ?? 'fk';

                  return (
                    <div key={key} className="rounded border border-ridge/60 bg-white/75 p-2">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="truncate text-[8px] font-black uppercase tracking-[0.2em] text-ink">
                          {formatJointLabel(key)}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleJointModeChange(key, 'bend')}
                            className={`h-6 w-6 rounded border text-[8px] font-black ${
                              currentMode === 'bend' ? 'border-selection bg-selection text-white' : 'border-ridge bg-white text-ink hover:bg-shell'
                            }`}
                          >
                            B
                          </button>
                          <button
                            type="button"
                            onClick={() => handleJointModeChange(key, 'stretch')}
                            className={`h-6 w-6 rounded border text-[8px] font-black ${
                              currentMode === 'stretch' ? 'border-selection bg-selection text-white' : 'border-ridge bg-white text-ink hover:bg-shell'
                            }`}
                          >
                            S
                          </button>
                          <span className="w-12 text-right text-[8px] font-black uppercase tracking-[0.18em] text-selection">
                            {Math.round(pivotOffsets[key])}°
                          </span>
                        </div>
                      </div>
                      <input
                        type="range"
                        min={POSE_JOINT_SLIDER_MIN}
                        max={POSE_JOINT_SLIDER_MAX}
                        step="1"
                        value={pivotOffsets[key]}
                        onChange={(event) => handlePoserPivotChange(key, parseFloat(event.target.value))}
                        className="h-1 w-full accent-selection"
                      />
                      <div className="mt-1 text-[6px] font-black uppercase tracking-[0.22em] text-mono-light">
                        {currentMode.toUpperCase()}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </Section>

          <Section title="Running" count={gaitKeyGroups.core.length + gaitKeyGroups.advanced.length + strideEntryOptions.length} defaultOpen>
            <div className="space-y-4">
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

              <div className="rounded border border-ridge bg-white/70 px-3 py-3">
                <div className="mb-3 text-[7px] font-black uppercase tracking-[0.26em] text-mono-light">Advanced</div>
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
              </div>
            </div>
          </Section>

          <Section title="Idle" count={7} defaultOpen={false}>
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
                  onClick={() => setShowAnimatedExportPicker(true)}
                  disabled={isExporting || Boolean(pendingExport)}
                  className="rounded border border-selection bg-selection px-3 py-2 text-[8px] font-black uppercase tracking-[0.18em] text-white transition-all hover:bg-selection-light disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isExporting ? 'Exporting' : 'Export'}
                </button>
              </div>

              <div className="text-[8px] uppercase leading-snug tracking-[0.18em] text-mono-light">
                Exports use the current procedural walk cycle.
              </div>
            </div>
          </Section>

          {showAnimatedExportPicker && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4">
              <div className="w-full max-w-sm rounded-2xl border border-ridge bg-white p-4 shadow-2xl">
                <div className="flex items-start justify-between gap-3 border-b border-ridge pb-3">
                  <div>
                    <div className="text-[9px] font-black uppercase tracking-[0.24em] text-ink">Animated Export FPS</div>
                    <div className="mt-1 text-[7px] font-black uppercase tracking-[0.18em] text-mono-light">
                      Choose the frame rate for GIF or WebM output.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowAnimatedExportPicker(false)}
                    className="rounded-full border border-ridge bg-shell px-2 py-1 text-[8px] font-black uppercase tracking-[0.18em] text-ink hover:bg-white"
                  >
                    Close
                  </button>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  {ANIMATED_EXPORT_FPS_OPTIONS.map((fps) => {
                    const active = animatedExportFps === fps;
                    return (
                      <button
                        key={fps}
                        type="button"
                        onClick={() => {
                          setAnimatedExportFps(fps);
                          setShowAnimatedExportPicker(false);
                          requestExport('animated');
                        }}
                        className={`rounded border px-3 py-3 text-left transition-all ${
                          active ? 'border-selection bg-selection text-white shadow-md' : 'border-ridge bg-white hover:bg-shell'
                        }`}
                      >
                        <div className="text-[10px] font-black tracking-[0.18em]">{fps} FPS</div>
                        <div className={`mt-1 text-[6px] uppercase tracking-[0.16em] ${active ? 'text-white/70' : 'text-mono-light'}`}>
                          animated export
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {showConsole && (
            <div className="space-y-3">
              <div className="rounded border border-ridge bg-shell px-3 py-2 text-[8px] font-black uppercase tracking-[0.2em] text-ink">
                <div className="mb-2 text-[7px] tracking-[0.24em] text-mono-light">Canvas State</div>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full border border-ridge bg-white px-2 py-1 text-[7px] tracking-[0.18em] text-mono-mid">
                    {shellMode.toUpperCase()}
                  </span>
                  <span className="rounded-full border border-ridge bg-white px-2 py-1 text-[7px] tracking-[0.18em] text-mono-mid">
                    {workspaceMode.toUpperCase()}
                  </span>
                  <span className="rounded-full border border-ridge bg-white px-2 py-1 text-[7px] tracking-[0.18em] text-mono-mid">
                    {gaitModeRef.current.toUpperCase()}
                  </span>
                  <span className="rounded-full border border-ridge bg-white px-2 py-1 text-[7px] tracking-[0.18em] text-mono-mid">
                    {isPaused ? 'PAUSED' : 'LIVE'}
                  </span>
                  <span className="rounded-full border border-ridge bg-white px-2 py-1 text-[7px] tracking-[0.18em] text-mono-mid">
                    phase {phaseToPercent(displayedPose.stride_phase ?? 0)}%
                  </span>
                  <span className="rounded-full border border-ridge bg-white px-2 py-1 text-[7px] tracking-[0.18em] text-mono-mid">
                    pins {activePinsList.length}
                  </span>
                  <span className="rounded-full border border-ridge bg-white px-2 py-1 text-[7px] tracking-[0.18em] text-mono-mid">
                    {displayLabels ? 'labels on' : 'labels off'}
                  </span>
                  <span className="rounded-full border border-ridge bg-white px-2 py-1 text-[7px] tracking-[0.18em] text-mono-mid">
                    {displayPivots ? 'pivots on' : 'pivots off'}
                  </span>
                </div>
              </div>

              <SystemLogger logs={systemLogs} isVisible={showConsole} />
            </div>
          )}
        </div>
      </aside>
    </div>
  );
};

export default App;
