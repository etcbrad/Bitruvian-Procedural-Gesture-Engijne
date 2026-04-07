import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  WalkingEnginePose, WalkingEngineGait, WalkingEnginePivotOffsets, WalkingEngineProportions, 
  JointModesState, IdleSettings, PartName, GaitPresetTemplate, IdlePresetTemplate, 
  LotteSettings, PhysicsControls, Vector2D, GhostState, AnimationClip, AnimationState, Keyframe,
  CharacterMorphology, MicroScriptInstance
} from './types';
import { ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT, MANNEQUIN_LOCAL_FLOOR_Y, TIMING, UI } from './constants';
import { Mannequin } from './components/Mannequin';
import { SystemLogger } from './components/SystemLogger';
import { LocomotionState, INITIAL_LOCOMOTION_STATE, updateLocomotionPhysics } from './utils/locomotionEngine';
import { updateIdlePhysics } from './utils/idleEngine';
import { applyFootGrounding } from './utils/groundingEngine';
import { lerp, easeInOutQuint, clamp } from './utils/kinematics';
import { GaitSynthesizer } from './utils/gaitSynthesis';
import { CharacterGenerator } from './utils/characterGenerator';
import { CharacterLibraryManager } from './utils/characterLibrary';
import { processActiveScripts, getScriptsForTrait, MICRO_SCRIPTS } from './utils/microScripts';
import { BehaviorEngine } from './utils/behaviorEngine';

const gaitSliderConfig: Partial<Record<keyof WalkingEngineGait, { min: number; max: number; step: number; label: string; category: string }>> = {
  intensity: { min: 0, max: 2, step: 0.01, label: 'Kinetic Intensity', category: 'Primary' },
  frequency: { min: 0.1, max: 3, step: 0.01, label: 'Cycle Frequency', category: 'Primary' },
  stride: { min: 0, max: 2, step: 0.01, label: 'Stride Length', category: 'Primary' },
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

const App: React.FC = () => {
  const { 
    pose, gait, idleSettings, pivotOffsets, proportions, physics, lotteSettings, activePins, gravityCenter, vibeScale,
    setPose, setGait, setIdleSettings, setPivotOffsets, setActivePins, setGravityCenter, setVibeScale
  } = useMannequinStore();

  const safeActivePins = Array.isArray(activePins) ? activePins : [];

  const [library] = useState(() => new CharacterLibraryManager());
  const [characters, setCharacters] = useState<CharacterMorphology[]>([]);
  const [currentCharacter, setCurrentCharacter] = useState<CharacterMorphology | null>(null);
  const [charDescription, setCharDescription] = useState('');
  
  const [showPivots, setShowPivots] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [isIkEnabled, setIsIkEnabled] = useState(true);
  const [targetFps, setTargetFps] = useState(TIMING.DEFAULT_TARGET_FPS);
  const [isConsoleVisible, setIsConsoleVisible] = useState(true);
  const [zoomIndex, setZoomIndex] = useState(UI.DEFAULT_ZOOM_INDEX);
  const [panOffset, setPanOffset] = useState<Vector2D>({ x: 0, y: 0 });
  const [viewBox, setViewBox] = useState(`${UI.BASE_VIEWBOX.x} ${UI.BASE_VIEWBOX.y} ${UI.BASE_VIEWBOX.width} ${UI.BASE_VIEWBOX.height}`);
  
  const [engineMode, setEngineMode] = useState<'locomotion' | 'idle'>('locomotion');
  const [tensions, setTensions] = useState<Record<string, number>>({});
  const [activeScripts, setActiveScripts] = useState<MicroScriptInstance[]>([]);
  const [systemLogs, setSystemLogs] = useState<{ timestamp: string; message: string }[]>([]);
  const H = 150;

  const locomotionStateRef = useRef<LocomotionState>({ ...INITIAL_LOCOMOTION_STATE });
  const lastFrameTimeRef = useRef(0);
  const locomotionWeightRef = useRef(1.0);

  useEffect(() => {
    library.init().then(() => library.getAllCharacters().then(setCharacters));
  }, []);

  const logSystem = (msg: string) => setSystemLogs(p => [...p.slice(-15), { timestamp: new Date().toLocaleTimeString(), message: msg }]);

  useEffect(() => {
    if (!currentCharacter || isPaused) return;
    const interval = setInterval(() => {
      const scriptId = BehaviorEngine.shouldTriggerFidget(currentCharacter.tags, vibeScale);
      if (scriptId) {
        const scriptDef = MICRO_SCRIPTS[scriptId];
        setActiveScripts(prev => {
          if (prev.some(s => s.scriptId === scriptId)) return prev;
          return [...prev, {
            id: `script_${Date.now()}`,
            scriptId,
            startTime: performance.now(),
            duration: scriptDef.duration,
            weight: vibeScale
          }];
        });
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
    setCharacters(p => [...p, char]);
    setCurrentCharacter(char);
    setGait(GaitSynthesizer.synthesizeGait(char, vibeScale));
    setCharDescription('');
    logSystem(`Genome Calibrated: ${char.name}`);
  };

  useEffect(() => {
    if (currentCharacter) setGait(GaitSynthesizer.synthesizeGait(currentCharacter, vibeScale));
  }, [vibeScale, currentCharacter]);

  useEffect(() => {
    const zoom = UI.ZOOM_LEVELS[zoomIndex];
    const newWidth = UI.BASE_VIEWBOX.width / zoom;
    const newHeight = UI.BASE_VIEWBOX.height / zoom;
    setViewBox(`${UI.BASE_VIEWBOX.x - (newWidth - UI.BASE_VIEWBOX.width) / 2 + panOffset.x} ${UI.BASE_VIEWBOX.y - (newHeight - UI.BASE_VIEWBOX.height) / 2 + panOffset.y} ${newWidth} ${newHeight}`);
  }, [zoomIndex, panOffset]);

  useEffect(() => {
    if (safeActivePins.length > 0) {
      const threshold = 100;
      if (Math.abs(pose.x_offset - panOffset.x) > threshold || Math.abs(pose.y_offset - panOffset.y) > threshold) {
        setPanOffset({ x: pose.x_offset, y: pose.y_offset });
      }
    }
  }, [pose.x_offset, pose.y_offset, safeActivePins]);

  const generatePoseAtPhase = useCallback((phase: number) => {
    const p = (phase * Math.PI * 2);
    const locPose = updateLocomotionPhysics(p, { ...INITIAL_LOCOMOTION_STATE }, gait, DEFAULT_PHYSICS, DEFAULT_PROPORTIONS, safeActivePins, 150, gravityCenter, H, isIkEnabled, 1.0);
    const { adjustedPose } = applyFootGrounding(locPose, DEFAULT_PROPORTIONS, H, DEFAULT_PHYSICS, safeActivePins, idleSettings, gravityCenter, 1.0, 16);
    return adjustedPose as WalkingEnginePose;
  }, [gait, safeActivePins, idleSettings, isIkEnabled, gravityCenter]);

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
      
      const locPose = updateLocomotionPhysics(p, locomotionStateRef.current, gait, DEFAULT_PHYSICS, DEFAULT_PROPORTIONS, activePins, 150, gravityCenter, H, isIkEnabled, locWeight);
      const idlePose = updateIdlePhysics(time, elapsed, idleSettings, locWeight, currentCharacter?.tags || []);
      const { pose: scriptPose, remaining } = processActiveScripts(time, activeScripts);
      if (remaining.length !== activeScripts.length) setActiveScripts(remaining);

      const blendedPose = BehaviorEngine.blendPose(locPose, idlePose, scriptPose, locWeight, gait, time);
      const { adjustedPose, tensions: groundTensions } = applyFootGrounding(blendedPose, DEFAULT_PROPORTIONS, H, DEFAULT_PHYSICS, activePins, idleSettings, gravityCenter, locWeight, elapsed);
      
      setTensions(groundTensions);
      setPose(adjustedPose as WalkingEnginePose);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [isPaused, gait, activePins, idleSettings, isIkEnabled, targetFps, engineMode, activeScripts, currentCharacter, gravityCenter]);

  const categories = ['Primary', 'Body', 'Arms', 'Legs', 'Effects'];

  return (
    <div className="w-full h-full flex bg-shell select-none overflow-hidden font-mono text-ink">
      {isConsoleVisible && (
        <div className="w-80 border-r border-ridge bg-white p-4 flex flex-col gap-1 custom-scrollbar overflow-y-auto shrink-0 z-20 shadow-2xl">
          <h1 className="text-xl font-archaic tracking-[0.3em] border-b-4 border-selection pb-1 text-ink uppercase italic flex items-center justify-between">
            <span>BITRUVIUS</span>
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

          <CollapsibleSection title="Gait Matrix" count={Object.keys(gaitSliderConfig).length}>
             <div className="flex flex-col gap-4 h-72 overflow-y-auto pr-3 custom-scrollbar">
               {categories.map(cat => (
                 <div key={cat} className="flex flex-col gap-2.5">
                    <div className="text-[7px] font-black text-mono-light uppercase border-b border-ridge pb-1 tracking-tighter opacity-60">{cat} Layers</div>
                    {Object.entries(gaitSliderConfig)
                      .filter(([_, conf]) => conf.category === cat)
                      .map(([key, conf]) => (
                        <div key={key} className="flex flex-col">
                           <div className="flex justify-between text-[7px] font-black text-selection uppercase">
                              <span>{conf.label}</span>
                              <span className="opacity-50">{(gait[key as keyof WalkingEngineGait] || 0).toFixed(2)}</span>
                           </div>
                           <input 
                              type="range" min={conf.min} max={conf.max} step={conf.step} 
                              value={gait[key as keyof WalkingEngineGait] ?? 0} 
                              onChange={(e) => setGait(p => ({...p, [key]: parseFloat(e.target.value)}))}
                              className="w-full h-1 accent-selection"
                           />
                        </div>
                      ))}
                 </div>
               ))}
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
                       <span className="text-selection font-bold">{((idleSettings[k as keyof IdleSettings] as number) || 0).toFixed(2)}</span>
                    </div>
                    <input 
                      type="range" min="0" max="1" step="0.01" 
                      value={((idleSettings as any)[k] ?? 0)} 
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
            <button onClick={() => setIsPaused(!isPaused)} className={`px-5 py-1 text-[9px] font-black border-2 border-selection rounded-full shadow-lg ${isPaused ? 'bg-accent-red text-white' : 'bg-white'}`}>{isPaused ? 'RESUME ENGINE' : 'PAUSE ENGINE'}</button>
        </div>

        <div className="absolute top-4 right-4 flex flex-col gap-2 z-50">
          <button onClick={() => setZoomIndex(prev => Math.min(UI.ZOOM_LEVELS.length - 1, prev + 1))} className="w-10 h-10 flex items-center justify-center bg-white border-2 border-selection font-black shadow-lg hover:bg-shell rounded-xl transition-transform active:scale-90">+</button>
          <button onClick={() => setZoomIndex(UI.DEFAULT_ZOOM_INDEX)} className="w-10 h-10 flex items-center justify-center bg-white border-2 border-selection text-[8px] font-black shadow-lg hover:bg-shell rounded-xl transition-transform active:scale-90">RST</button>
          <button onClick={() => setZoomIndex(prev => Math.max(0, prev - 1))} className="w-10 h-10 flex items-center justify-center bg-white border-2 border-selection font-black shadow-lg hover:bg-shell rounded-xl transition-transform active:scale-90">-</button>
        </div>

        <svg viewBox={viewBox} className="w-full h-full relative z-10 bg-triangle-grid">
          <g transform={`translate(${pose.x_offset}, ${400 - (MANNEQUIN_LOCAL_FLOOR_Y * H) + pose.y_offset})`}>
            <Mannequin 
              pose={pose} bodyRotation={0} pivotOffsets={pivotOffsets} props={DEFAULT_PROPORTIONS} 
              showPivots={showPivots} baseUnitH={H * (currentCharacter?.anatomy.bodyLength || 1)} 
              onAnchorMouseDown={(k) => setActivePins(p => (Array.isArray(p) ? p : []).includes(k) ? (Array.isArray(p) ? p : []).filter(x => x !== k) : [...(Array.isArray(p) ? p : []), k])} 
              draggingBoneKey={null} isPaused={isPaused} activePins={safeActivePins} tensions={tensions} jointModes={{}} lotteSettings={DEFAULT_LOTTE_SETTINGS}
              ghosts={[]}
              ghostDataGenerator={generatePoseAtPhase}
            />
          </g>
        </svg>

        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-8 text-[8px] font-black text-selection/30 pointer-events-none uppercase tracking-[0.8em] items-center">
            <span>BITRUVIUS PHASE 0.2 // CALIBRATION MODE</span>
            <div className="w-1.5 h-1.5 bg-selection/30 rounded-full" />
            <span>COG BIAS: {gravityCenter.toUpperCase()}</span>
        </div>
      </div>
    </div>
  );
};

export default App;
