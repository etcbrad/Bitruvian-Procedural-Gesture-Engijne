
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  WalkingEnginePose, WalkingEngineGait, WalkingEnginePivotOffsets, WalkingEngineProportions, 
  IdleSettings, LotteSettings, PhysicsControls, Vector2D, GaitMode,
  CharacterMorphology, MicroScriptInstance
} from './types';
import { MANNEQUIN_LOCAL_FLOOR_Y, TIMING, UI } from './constants';
import { Mannequin } from './components/Mannequin';
import { SystemLogger } from './components/SystemLogger';
import { LocomotionState, INITIAL_LOCOMOTION_STATE, updateLocomotionPhysics } from './utils/locomotionEngine';
import { updateIdlePhysics } from './utils/idleEngine';
import { applyFootGrounding } from './utils/groundingEngine';
import { lerp, clamp } from './utils/kinematics';
import { GaitSynthesizer, applyGaitModeEnvelope, normalizeGaitModeEnvelope } from './utils/gaitSynthesis';
import { CharacterGenerator } from './utils/characterGenerator';
import { CharacterLibraryManager } from './utils/characterLibrary';
import { processActiveScripts, MICRO_SCRIPTS } from './utils/microScripts';
import { BehaviorEngine } from './utils/behaviorEngine';
import { exportAnimatedLoop, exportKeyframes, exportLoopFrames, type AnimatedExportFormat } from './utils/animationExport';

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
  heavyStomp: { min: 0, max: 1, step: 0.01, label: 'Impact Density', category: 'Effects' },
  footDrag: { min: 0, max: 1, step: 0.01, label: 'Frictional Drag', category: 'Effects' },
};

const gaitModeOptions: { mode: GaitMode; label: string; note: string }[] = [
  { mode: 'walk', label: 'WALK', note: 'grounded' },
  { mode: 'jog', label: 'JOG', note: 'balanced' },
  { mode: 'run', label: 'RUN', note: 'driving' },
];

type StrideEntryStyle = 'tiptoe' | 'neutral' | 'drive';

const strideEntryOptions: { style: StrideEntryStyle; label: string; note: string }[] = [
  { style: 'tiptoe', label: 'TIPTOE', note: 'forefoot' },
  { style: 'neutral', label: 'NEUTRAL', note: 'midfoot' },
  { style: 'drive', label: 'DRIVE', note: 'push-off' },
];

const STRIDE_BANDS: Record<GaitMode, { uiMin: number; uiMax: number; actualMin: number; actualMax: number }> = {
  walk: { uiMin: 0, uiMax: 50, actualMin: 0.22, actualMax: 0.95 },
  jog: { uiMin: 50, uiMax: 75, actualMin: 0.95, actualMax: 1.45 },
  run: { uiMin: 75, uiMax: 100, actualMin: 1.45, actualMax: 2.05 },
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

const DEFAULT_RESTING_POSE: WalkingEnginePose = { 
  bodyRotation: 0, waist: 0, neck: 0, collar: 0, torso: 0, 
  l_shoulder: 15, r_shoulder: -15, 
  l_elbow: -10, r_elbow: -10, 
  l_hand: 0, r_hand: 0, 
  l_hip: 0, r_hip: 0, 
  l_knee: 10, r_knee: 10, 
  l_foot: -90, r_foot: -90, stride_phase: 0, y_offset: 0, x_offset: 0 
};

const DEFAULT_IDLE_SETTINGS: IdleSettings = { 
  breathing: 0.4, weightShift: 0.2, gazeSway: 0.3, tension: 0.1, fidgetFrequency: 0.2, 
  transitionSpeed: 0.3, posture: 0.0, idlePinnedFeet: 'none' 
};

const DEFAULT_PIVOT_OFFSETS: WalkingEnginePivotOffsets = { 
  neck: 0, collar: 0, torso: 0, waist: 0, 
  l_shoulder: 0, r_shoulder: 0, l_elbow: 0, r_elbow: 0, l_hand: 0, r_hand: 0, 
  l_hip: 0, r_hip: 0, l_knee: 0, r_knee: 0, l_foot: 0, r_foot: 0 
};

const DEFAULT_PROPORTIONS: WalkingEngineProportions = { 
  head: { w: 1, h: 1 }, collar: { w: 1, h: 1 }, torso: { w: 1, h: 1 }, waist: { w: 1, h: 1 }, 
  l_upper_arm: { w: 1, h: 1 }, l_lower_arm: { w: 1, h: 1 }, l_hand: { w: 1, h: 1 }, 
  r_upper_arm: { w: 1, h: 1 }, r_lower_arm: { w: 1, h: 1 }, r_hand: { w: 1, h: 1 }, 
  l_upper_leg: { w: 1, h: 1 }, l_lower_leg: { w: 1, h: 1 }, l_foot: { w: 1, h: 1 }, 
  r_upper_leg: { w: 1, h: 1 }, r_lower_leg: { w: 1, h: 1 }, r_foot: { w: 1, h: 1 } 
};

const DEFAULT_PHYSICS: PhysicsControls = { 
  motionSmoothing: 0.85, jointElasticity: 0.8, stabilization: 0.75, 
  impactDamping: 0.2, bodyMass: 0.5, pendulumDrag: 0.3, bounceIntensity: 0.5 
};

const DEFAULT_LOTTE_SETTINGS: LotteSettings = { 
  enabled: false, frameStepping: true, cutoutSnap: true, 
  paperJitter: true, shadowBlur: false, profileLock: false 
};

const CollapsibleSection: React.FC<{ title: string; children: React.ReactNode; defaultOpen?: boolean; count?: number }> = ({ title, children, defaultOpen = true, count }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="flex flex-col mb-1 border-b border-ridge/20">
      <button 
        onClick={() => setIsOpen(!isOpen)} 
        className="flex justify-between items-center w-full py-2.5 px-1 text-[9px] font-black tracking-widest uppercase hover:bg-mono-darker/50 transition-colors"
      >
        <span className="flex items-center gap-2">
            <span className={isOpen ? 'text-selection' : 'text-mono-light'}>{isOpen ? '▼' : '▶'}</span>
            {title}
        </span>
        {count !== undefined && <span className="text-[7px] bg-mono-dark px-1.5 py-0.5 rounded border border-ridge text-mono-light">{count}</span>}
      </button>
      {isOpen && <div className="p-2 pt-0 flex flex-col gap-3">{children}</div>}
    </div>
  );
};

import { useMannequinStore } from './store';
// ... (rest of imports)

const App: React.FC = () => {
  const { 
    pose, gait, idleSettings, pivotOffsets, activePins, gravityCenter, vibeScale,
    setPose, setGait, setIdleSettings, setPivotOffsets, setActivePins, setVibeScale
  } = useMannequinStore();

  const safeActivePins = Array.isArray(activePins) ? activePins : [];

  const [library] = useState(() => new CharacterLibraryManager());
  const [currentCharacter, setCurrentCharacter] = useState<CharacterMorphology | null>(null);
  const [charDescription, setCharDescription] = useState('');
  const [gaitMode, setGaitMode] = useState<GaitMode>('jog');
  const [strideEntryStyle, setStrideEntryStyle] = useState<StrideEntryStyle>('tiptoe');
  
  const [showPivots, setShowPivots] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [targetFps, setTargetFps] = useState(TIMING.DEFAULT_TARGET_FPS);
  const [isConsoleVisible, setIsConsoleVisible] = useState(true);
  const [exportFormat, setExportFormat] = useState<AnimatedExportFormat>('gif');
  const [isExporting, setIsExporting] = useState(false);
  const [pendingExport, setPendingExport] = useState<{ mode: 'frames' | 'keyframes' | 'animated' } | null>(null);
  const [zoomIndex, setZoomIndex] = useState(UI.DEFAULT_ZOOM_INDEX);
  const [panOffset, setPanOffset] = useState<Vector2D>({ x: 0, y: 0 });
  const [viewBox, setViewBox] = useState(`${UI.BASE_VIEWBOX.x} ${UI.BASE_VIEWBOX.y} ${UI.BASE_VIEWBOX.width} ${UI.BASE_VIEWBOX.height}`);
  const [groundY, setGroundY] = useState(UI.BASE_VIEWBOX.y + UI.BASE_VIEWBOX.height - 4);
  
  const [engineMode, setEngineMode] = useState<'locomotion' | 'idle'>('locomotion');
  const [tensions, setTensions] = useState<Record<string, number>>({});
  const [systemLogs, setSystemLogs] = useState<{ timestamp: string; message: string }[]>([]);
  const H = 150;

  const activeScriptsRef = useRef<MicroScriptInstance[]>([]);
  const locomotionStateRef = useRef<LocomotionState>({ ...INITIAL_LOCOMOTION_STATE });
  const lastFrameTimeRef = useRef(0);
  const locomotionWeightRef = useRef(1.0);
  const gaitModeRef = useRef<GaitMode>('jog');
  const strideEntryStyleRef = useRef<StrideEntryStyle>('tiptoe');
  const gaitBaseRef = useRef<WalkingEngineGait>(normalizeGaitModeEnvelope(gait, gaitMode));
  const isPausedRef = useRef(isPaused);

  useEffect(() => {
    library.init();
  }, []);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  const logSystem = (msg: string) => setSystemLogs(p => [...p.slice(-15), { timestamp: new Date().toLocaleTimeString(), message: msg }]);

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
    setGaitMode(mode);
    const modeGait = applyGaitModeEnvelope(gaitBaseRef.current, mode);
    setGait(applyGaitAdjustments(modeGait, STRIDE_ENTRY_STYLE_ADJUSTMENTS[strideEntryStyleRef.current]));
    logSystem(`Gait Mode: ${mode.toUpperCase()}`);
  }, [setGait, logSystem]);

  const updateStrideEntryStyle = useCallback((style: StrideEntryStyle) => {
    strideEntryStyleRef.current = style;
    setStrideEntryStyle(style);
    const modeGait = applyGaitModeEnvelope(gaitBaseRef.current, gaitModeRef.current);
    setGait(applyGaitAdjustments(modeGait, STRIDE_ENTRY_STYLE_ADJUSTMENTS[style]));
    logSystem(`Stride Entry: ${style.toUpperCase()}`);
  }, [setGait, logSystem]);

  useEffect(() => {
    applyDisplayedGaitFromBase(gaitBaseRef.current);
  }, [applyDisplayedGaitFromBase]);

  useEffect(() => {
    if (!currentCharacter || isPaused) return;
    const interval = setInterval(() => {
      const scriptId = BehaviorEngine.shouldTriggerFidget(currentCharacter.tags, vibeScale);
      if (scriptId) {
        const scriptDef = MICRO_SCRIPTS[scriptId];
        const existing = activeScriptsRef.current.some(s => s.scriptId === scriptId);
        if (!existing) {
          activeScriptsRef.current = [...activeScriptsRef.current, {
            id: `script_${Date.now()}`,
            scriptId,
            startTime: performance.now(),
            duration: scriptDef.duration,
            weight: vibeScale
          }];
        }
        logSystem(`Proc-Trigger: ${scriptId.toUpperCase()}`);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [currentCharacter, vibeScale, isPaused]);

  const generateCharacter = async () => {
    const prompt = charDescription.trim() || 'Bitruvian Walker';
    // Mixed entropy ensures unique manifestations even for the same text prompt
    const char = CharacterGenerator.generateCharacter(prompt, Math.random() * 1000000 + Date.now());
    await library.saveCharacter(char);
    setCurrentCharacter(char);
    applyDisplayedGaitFromBase(GaitSynthesizer.synthesizeGait(char, vibeScale));
    setCharDescription('');
    logSystem(`Genome Calibrated: ${char.name}`);
  };

  useEffect(() => {
    if (currentCharacter) {
      applyDisplayedGaitFromBase(GaitSynthesizer.synthesizeGait(currentCharacter, vibeScale));
    }
  }, [vibeScale, currentCharacter, applyDisplayedGaitFromBase]);

  useEffect(() => {
    const zoom = UI.ZOOM_LEVELS[zoomIndex];
    const newWidth = UI.BASE_VIEWBOX.width / zoom;
    const newHeight = UI.BASE_VIEWBOX.height / zoom;
    const nextX = UI.BASE_VIEWBOX.x - (newWidth - UI.BASE_VIEWBOX.width) / 2 + panOffset.x;
    const nextY = UI.BASE_VIEWBOX.y - (newHeight - UI.BASE_VIEWBOX.height) / 2 + panOffset.y;
    setViewBox(`${nextX} ${nextY} ${newWidth} ${newHeight}`);
    setGroundY(nextY + newHeight - 4);
  }, [zoomIndex, panOffset]);

  useEffect(() => {
    if (safeActivePins.length > 0) {
      const threshold = 100;
      if (Math.abs(pose.x_offset - panOffset.x) > threshold || Math.abs(pose.y_offset - panOffset.y) > threshold) {
        setPanOffset({ x: pose.x_offset, y: pose.y_offset });
      }
    }
  }, [pose.x_offset, pose.y_offset, safeActivePins]);

  useEffect(() => {
    const renderGameToText = () => JSON.stringify({
      coordinateSystem: 'SVG-like: +x right, +y down',
      mode: engineMode,
      paused: isPaused,
      zoom: UI.ZOOM_LEVELS[zoomIndex],
      currentCharacter: currentCharacter ? { name: currentCharacter.name, type: currentCharacter.type, tags: currentCharacter.tags } : null,
      pose: {
        x: pose.x_offset,
        y: pose.y_offset,
        waist: pose.waist,
        torso: pose.torso,
        collar: pose.collar,
        neck: pose.neck,
        lHip: pose.l_hip,
        rHip: pose.r_hip,
        lKnee: pose.l_knee,
        rKnee: pose.r_knee,
        lFoot: pose.l_foot,
        rFoot: pose.r_foot,
      },
      gait: {
        mode: gaitMode,
        entryStyle: strideEntryStyle,
        intensity: gait.intensity,
        frequency: gait.frequency,
        stride: gait.stride,
        lean: gait.lean,
        verticality: gait.verticality,
        armSwing: gait.arm_swing,
        footDrag: gait.footDrag,
      },
      idle: {
        breathing: idleSettings.breathing,
        tension: idleSettings.tension,
        fidgetFrequency: idleSettings.fidgetFrequency,
      },
      activePins: safeActivePins,
      activeScripts: activeScriptsRef.current.length,
      gravityCenter,
      logs: systemLogs.slice(-5),
      exporting: isExporting,
    });

    (window as Window & { render_game_to_text?: () => string }).render_game_to_text = renderGameToText;
    return () => {
      const target = window as Window & { render_game_to_text?: () => string };
      if (target.render_game_to_text === renderGameToText) delete target.render_game_to_text;
    };
  }, [engineMode, isPaused, zoomIndex, currentCharacter, pose, gait, idleSettings, safeActivePins, gravityCenter, gaitMode, strideEntryStyle, systemLogs, isExporting]);

  const generatePoseAtPhase = useCallback((phase: number) => {
    const p = (phase * Math.PI * 2);
    const locPose = updateLocomotionPhysics(p, { ...INITIAL_LOCOMOTION_STATE }, gait, DEFAULT_PHYSICS, 1.0);
    const { adjustedPose } = applyFootGrounding(locPose, DEFAULT_PROPORTIONS, H, DEFAULT_PHYSICS, safeActivePins, idleSettings, gravityCenter, 1.0, 16);
    return adjustedPose as WalkingEnginePose;
  }, [gait, safeActivePins, idleSettings, gravityCenter]);

  const buildExportContext = useCallback(() => ({
    viewBox,
    groundY,
    baseUnitH: H * (currentCharacter?.anatomy.bodyLength || 1),
    gait,
    idleSettings,
    activePins: safeActivePins,
    pivotOffsets,
    gravityCenter,
    lotteSettings: DEFAULT_LOTTE_SETTINGS,
  }), [viewBox, groundY, gait, idleSettings, safeActivePins, pivotOffsets, gravityCenter, currentCharacter]);

  const exportFps = Math.min(24, targetFps);

  const requestExport = useCallback((mode: 'frames' | 'keyframes' | 'animated') => {
    if (isExporting) return;
    setPendingExport({ mode });
  }, [isExporting]);

  useEffect(() => {
    if (!pendingExport) return;
    let cancelled = false;
    const context = buildExportContext();
    const shouldRestorePause = !isPausedRef.current;

    const run = async () => {
      if (shouldRestorePause) {
        setIsPaused(true);
      }
      setIsExporting(true);
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
          const animatedExportFps = exportFormat === 'gif' ? Math.min(12, exportFps) : exportFps;
          const animatedExportScale = exportFormat === 'gif' ? 0.6 : 0.75;
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
          if (shouldRestorePause) {
            setIsPaused(false);
          }
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [pendingExport, buildExportContext, exportFormat, exportFps, generatePoseAtPhase, logSystem]);

  useEffect(() => {
    let frame: number;
    const animate = (time: number) => {
      frame = requestAnimationFrame(animate);
      if (isPaused) return;
      const elapsed = time - lastFrameTimeRef.current;
      if (elapsed < 1000 / targetFps) return;
      lastFrameTimeRef.current = time;

      const targetWeight = engineMode === 'locomotion' ? 1.0 : 0.0;
      locomotionWeightRef.current = lerp(locomotionWeightRef.current, targetWeight, 0.08);
      const locWeight = locomotionWeightRef.current;

      const p = (time * 0.005 * gait.frequency) % (Math.PI * 2);
      
      const locPose = updateLocomotionPhysics(p, locomotionStateRef.current, gait, DEFAULT_PHYSICS, locWeight);
      const idlePose = updateIdlePhysics(time, elapsed, idleSettings, locWeight, currentCharacter?.tags || []);
      const activeScripts = activeScriptsRef.current;
      const { pose: scriptPose, remaining } = processActiveScripts(time, activeScripts);
      if (remaining.length !== activeScripts.length) activeScriptsRef.current = remaining;

      const blendedPose = BehaviorEngine.blendPose(locPose, idlePose, scriptPose, locWeight, gait, time);
      const { adjustedPose, tensions: groundTensions } = applyFootGrounding(blendedPose, DEFAULT_PROPORTIONS, H, DEFAULT_PHYSICS, activePins, idleSettings, gravityCenter, locWeight, elapsed);
      
      setTensions(groundTensions);
      setPose(adjustedPose as WalkingEnginePose);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [isPaused, gait, activePins, idleSettings, targetFps, engineMode, currentCharacter, gravityCenter]);

  return (
    <div className="w-full h-full flex bg-shell select-none overflow-hidden font-mono text-ink">
      {isConsoleVisible && (
        <div className="w-80 border-r border-ridge bg-white p-4 flex flex-col gap-1 custom-scrollbar overflow-y-auto shrink-0 z-20 shadow-2xl">
          <h1 className="text-xl font-archaic tracking-[0.3em] border-b-4 border-selection pb-1 text-ink uppercase italic flex items-center justify-between">
            <span>BITRUVIAN</span>
            <span className="text-[8px] bg-selection text-white px-2 py-0.5">0.2.C</span>
          </h1>
          
          <CollapsibleSection title="Behavioral Prompting" defaultOpen={true}>
            <textarea 
              value={charDescription}
              onChange={(e) => setCharDescription(e.target.value)}
              placeholder="e.g. 'A regally stiff queen' or 'A crouched sneaky villain'"
              className="w-full h-16 p-2.5 bg-shell border border-ridge text-[9px] resize-none focus:outline-none focus:border-selection font-bold"
            />
            <div className="flex flex-col gap-2">
              <div className="flex justify-between text-[8px] font-black uppercase text-mono-light">
                  <span>Vibe Intensity</span>
                  <span className="text-selection">{(vibeScale * 100).toFixed(0)}%</span>
              </div>
              <input type="range" min="0" max="2" step="0.01" value={vibeScale} onChange={(e) => setVibeScale(parseFloat(e.target.value))} className="w-full h-1 accent-selection" />
              <button onClick={generateCharacter} className="w-full py-2.5 bg-selection text-white text-[8px] font-black uppercase hover:bg-selection-light transition-all shadow-md">Calibrate Personality</button>
            </div>
          </CollapsibleSection>

          <CollapsibleSection title="Export" count={3} defaultOpen={true}>
             <div className="flex flex-col gap-2">
               <div className="grid grid-cols-2 gap-2">
                 <button
                   onClick={() => requestExport('frames')}
                   disabled={isExporting}
                   className="w-full py-2 bg-white border border-selection text-[8px] font-black uppercase hover:bg-shell disabled:opacity-50"
                 >
                   Loop Frames ZIP
                 </button>
                 <button
                   onClick={() => requestExport('keyframes')}
                   disabled={isExporting}
                   className="w-full py-2 bg-white border border-selection text-[8px] font-black uppercase hover:bg-shell disabled:opacity-50"
                 >
                   Keyframes ZIP
                 </button>
               </div>
               <div className="flex items-center gap-2">
                 <select
                   value={exportFormat}
                   onChange={(e) => setExportFormat(e.target.value as AnimatedExportFormat)}
                   className="flex-1 py-2 px-2 bg-shell border border-ridge text-[8px] font-black uppercase"
                 >
                   <option value="gif">GIF</option>
                   <option value="webm">Video (WebM)</option>
                 </select>
                 <button
                   onClick={() => requestExport('animated')}
                   disabled={isExporting}
                   className="px-3 py-2 bg-selection text-white text-[8px] font-black uppercase disabled:opacity-50"
                 >
                   {isExporting ? 'EXPORTING' : 'Export'}
                 </button>
               </div>
               <p className="text-[8px] leading-snug text-mono-light uppercase">
                 Exports the current gait loop. Frames stop just before reset.
               </p>
             </div>
          </CollapsibleSection>

          <CollapsibleSection title="Gait Controls" count={gaitKeyGroups.core.length + gaitKeyGroups.advanced.length + gaitModeOptions.length + strideEntryOptions.length} defaultOpen={true}>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-[7px] font-black uppercase text-mono-light tracking-[0.22em]">
                  <span>Gait Mode</span>
                  <span className="text-selection">{gaitMode.toUpperCase()}</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {gaitModeOptions.map((option) => {
                    const active = gaitMode === option.mode;
                    return (
                      <button
                        key={option.mode}
                        onClick={() => updateGaitMode(option.mode)}
                        className={`flex flex-col items-start gap-1 rounded border px-2 py-2 text-left transition-all ${
                          active ? 'border-selection bg-selection text-white shadow-md' : 'border-ridge bg-white hover:bg-shell'
                        }`}
                      >
                        <span className="text-[8px] font-black tracking-[0.18em]">{option.label}</span>
                        <span className={`text-[7px] uppercase tracking-[0.12em] ${active ? 'text-white/80' : 'text-mono-light'}`}>{option.note}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-[7px] font-black uppercase text-mono-light tracking-[0.22em]">
                  <span>Stride Entry</span>
                  <span className="text-selection">{strideEntryStyle.toUpperCase()}</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {strideEntryOptions.map((option) => {
                    const active = strideEntryStyle === option.style;
                    return (
                      <button
                        key={option.style}
                        onClick={() => updateStrideEntryStyle(option.style)}
                        className={`flex flex-col items-start gap-1 rounded border px-2 py-2 text-left transition-all ${
                          active ? 'border-selection bg-selection text-white shadow-md' : 'border-ridge bg-white hover:bg-shell'
                        }`}
                      >
                        <span className="text-[8px] font-black tracking-[0.18em]">{option.label}</span>
                        <span className={`text-[7px] uppercase tracking-[0.12em] ${active ? 'text-white/80' : 'text-mono-light'}`}>{option.note}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <div className="text-[7px] font-black text-mono-light uppercase border-b border-ridge pb-1 tracking-tighter opacity-60">Core Gait</div>
                {gaitKeyGroups.core.map((key) => {
                  const conf = gaitSliderConfig[key];
                  if (!conf) return null;
                  const strideBand = key === 'stride' ? STRIDE_BANDS[gaitMode] : null;
                  const displayValue = key === 'stride' ? mapStrideValueToPercent(gaitMode, gait[key]) : gait[key];
                  return (
                    <div key={key} className="flex flex-col">
                      <div className="flex justify-between text-[7px] font-black text-selection uppercase">
                        <span>{conf.label}</span>
                        <span className="opacity-50">{key === 'stride' ? `${Math.round(displayValue)}%` : gait[key].toFixed(2)}</span>
                      </div>
                      {key === 'stride' && (
                        <div className="mb-1 text-[6px] font-black uppercase tracking-[0.18em] text-mono-light">
                          Walk 0-50 | Jog 50-75 | Run 75-100
                        </div>
                      )}
                      <input
                        type="range"
                        min={key === 'stride' && strideBand ? strideBand.uiMin : conf.min}
                        max={key === 'stride' && strideBand ? strideBand.uiMax : conf.max}
                        step={key === 'stride' ? 1 : conf.step}
                        value={key === 'stride' ? displayValue : gait[key]}
                        onChange={(e) => {
                          const nextValue = parseFloat(e.target.value);
                          updateDisplayedGaitValue(key, key === 'stride' ? mapStridePercentToValue(gaitMode, nextValue) : nextValue);
                        }}
                        className="w-full h-1 accent-selection"
                      />
                    </div>
                  );
                })}
              </div>

              <CollapsibleSection title="Advanced" defaultOpen={false} count={gaitKeyGroups.advanced.length}>
                <div className="flex flex-col gap-3">
                  {gaitKeyGroups.advanced.map((key) => {
                    const conf = gaitSliderConfig[key];
                    if (!conf) return null;
                    return (
                      <div key={key} className="flex flex-col">
                        <div className="flex justify-between text-[7px] font-black text-selection uppercase">
                          <span>{conf.label}</span>
                          <span className="opacity-50">{gait[key].toFixed(2)}</span>
                        </div>
                        <input
                          type="range"
                          min={conf.min}
                          max={conf.max}
                          step={conf.step}
                          value={gait[key]}
                          onChange={(e) => updateDisplayedGaitValue(key, parseFloat(e.target.value))}
                          className="w-full h-1 accent-selection"
                        />
                      </div>
                    );
                  })}
                </div>
              </CollapsibleSection>
            </div>
          </CollapsibleSection>

          <CollapsibleSection title="Joint Bias Matrix" count={18}>
            <div className="grid grid-cols-1 gap-3 h-48 overflow-y-auto pr-3 custom-scrollbar">
              {Object.keys(pivotOffsets).map(k => (
                <div key={k} className="flex flex-col border-b border-ridge/20 pb-1">
                   <div className="flex justify-between text-[7px] font-black uppercase text-mono-light">
                      <span>{k.replace('_', '·')}</span>
                      <span className="text-selection font-bold">{(pivotOffsets[k as keyof WalkingEnginePivotOffsets])}°</span>
                   </div>
                   <input 
                      type="range" min="-180" max="180" 
                      value={pivotOffsets[k as keyof WalkingEnginePivotOffsets]} 
                      onChange={(e) => setPivotOffsets(p => ({...p, [k]: parseInt(e.target.value)}))}
                      className="w-full h-1 accent-selection"
                   />
                </div>
              ))}
            </div>
          </CollapsibleSection>

          <CollapsibleSection title="Idle Matrix" count={7}>
             <div className="flex flex-col gap-3">
                {Object.keys(DEFAULT_IDLE_SETTINGS).filter(k => k !== 'idlePinnedFeet').map(k => (
                  <div key={k} className="flex flex-col">
                    <div className="flex justify-between text-[7px] font-black uppercase text-mono-light">
                       <span>{k}</span>
                       <span className="text-selection font-bold">{(idleSettings[k as keyof IdleSettings] as number).toFixed(2)}</span>
                    </div>
                    <input 
                      type="range" min="0" max="1" step="0.01" 
                      value={(idleSettings as any)[k]} 
                      onChange={(e) => setIdleSettings(p => ({...p, [k]: parseFloat(e.target.value)}))}
                      className="w-full h-1 accent-selection"
                    />
                 </div>
                ))}
             </div>
          </CollapsibleSection>

          <div className="mt-auto pt-4 border-t border-ridge">
             <div className="flex gap-1 mb-2">
                <button onClick={() => setEngineMode('locomotion')} className={`flex-1 text-[8px] py-1.5 border font-black ${engineMode === 'locomotion' ? 'bg-selection text-white' : 'bg-white'}`}>WALK</button>
                <button onClick={() => setEngineMode('idle')} className={`flex-1 text-[8px] py-1.5 border font-black ${engineMode === 'idle' ? 'bg-selection text-white' : 'bg-white'}`}>IDLE</button>
             </div>
             <SystemLogger logs={systemLogs} isVisible={true} />
          </div>
        </div>
      )}

      <div className="flex-1 relative overflow-hidden bg-shell">
        <div className="absolute top-4 left-4 z-50 flex gap-2">
            <button onClick={() => setIsConsoleVisible(!isConsoleVisible)} className="p-2.5 bg-white border-2 border-selection hover:bg-shell rounded shadow-lg transition-all">{isConsoleVisible ? '✕' : '☰'}</button>
            <div className="px-4 py-1 bg-white/95 backdrop-blur-md border-2 border-selection rounded-full text-[9px] font-black text-selection flex items-center gap-3 shadow-lg">
                <div className={`w-2 h-2 rounded-full ${engineMode === 'locomotion' ? 'bg-green-500' : 'bg-blue-500'} animate-pulse`} />
                {engineMode.toUpperCase()} | {Math.round(locomotionWeightRef.current * 100)}% KINETIC WEIGHT
            </div>
            <button onClick={() => setIsPaused(prev => !prev)} className={`px-5 py-1 text-[9px] font-black border-2 border-selection rounded-full shadow-lg ${isPaused ? 'bg-accent-red text-white' : 'bg-white'}`}>{isPaused ? 'RESUME ENGINE' : 'PAUSE ENGINE'}</button>
        </div>

        <div className="absolute top-4 right-4 flex flex-col gap-2 z-50">
          <button onClick={() => setZoomIndex(prev => Math.min(UI.ZOOM_LEVELS.length - 1, prev + 1))} className="w-10 h-10 flex items-center justify-center bg-white border-2 border-selection font-black shadow-lg hover:bg-shell rounded-xl transition-transform active:scale-90">+</button>
          <button onClick={() => setZoomIndex(UI.DEFAULT_ZOOM_INDEX)} className="w-10 h-10 flex items-center justify-center bg-white border-2 border-selection text-[8px] font-black shadow-lg hover:bg-shell rounded-xl transition-transform active:scale-90">RST</button>
          <button onClick={() => setZoomIndex(prev => Math.max(0, prev - 1))} className="w-10 h-10 flex items-center justify-center bg-white border-2 border-selection font-black shadow-lg hover:bg-shell rounded-xl transition-transform active:scale-90">-</button>
        </div>

        <svg viewBox={viewBox} className="w-full h-full relative z-10 bg-triangle-grid">
          <g transform={`translate(${pose.x_offset}, ${groundY - (MANNEQUIN_LOCAL_FLOOR_Y * H) + pose.y_offset})`}>
            <Mannequin 
              pose={pose} bodyRotation={pose.bodyRotation} pivotOffsets={pivotOffsets} props={DEFAULT_PROPORTIONS} 
              showPivots={showPivots} baseUnitH={H * (currentCharacter?.anatomy.bodyLength || 1)} 
              onAnchorMouseDown={(k) => setActivePins((p) => (p.includes(k) ? p.filter(x => x !== k) : [...p, k]))} 
              draggingBoneKey={null} isPaused={isPaused} activePins={safeActivePins} tensions={tensions} jointModes={{}} lotteSettings={DEFAULT_LOTTE_SETTINGS}
              ghosts={[]}
              ghostDataGenerator={generatePoseAtPhase}
            />
          </g>
        </svg>

        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-8 text-[8px] font-black text-selection/30 pointer-events-none uppercase tracking-[0.8em] items-center">
            <span>BITRUVIAN PHASE 0.2 // CALIBRATION MODE</span>
            <div className="w-1.5 h-1.5 bg-selection/30 rounded-full" />
            <span>COG BIAS: {gravityCenter.toUpperCase()}</span>
        </div>
      </div>
    </div>
  );
};

export default App;
