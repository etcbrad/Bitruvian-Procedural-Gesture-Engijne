
import { IdleSettings, WalkingEnginePose, PartName } from '../types';
import { lerp, clamp } from './kinematics';
import { IDLE_PHYSICS } from '../constants';

let _gazeTargetX = 0;
let _gazeTargetY = 0;
let _lastGazeShiftTime = 0;
let _currentGazeX = 0;
let _currentGazeY = 0;

let _fidgetTargetNeck = 0;
let _fidgetTargetHand = 0;
let _lastFidgetShiftTime = 0;
let _currentFidgetNeck = 0;
let _currentFidgetHand = 0;

let _heavyBreathingIntensityInternal = 0;
let _tremorTarget = 0;
let _currentTremor = 0;
let _lastTremorUpdateTime = 0;

export const updateIdlePhysics = (
  time: number,
  deltaTime: number,
  settings: IdleSettings,
  locomotionWeight: number,
  traits: string[] = []
): Partial<WalkingEnginePose> => {
  const t = time;
  const traitsSet = new Set(traits);
  
  const traitBonus = (trait: string, bonus: number) => traitsSet.has(trait) ? bonus : 0;
  
  // Nervousness multipliers
  const nervousMult = 1.0 + traitBonus('nervous', 1.5) + traitBonus('anxious', 1.5) + traitBonus('scared', 2.0);
  const calmMult = traitsSet.has('calm') || traitsSet.has('relaxed') ? 0.4 : 1.0;
  const speedScale = nervousMult * calmMult;

  const dampenedSpeed = Math.pow(settings.transitionSpeed, 1 + IDLE_PHYSICS.MAX_SPEED_DAMPENING_FACTOR);
  const idleSpeed = lerp(0.05, 0.5, dampenedSpeed) * speedScale;

  if (locomotionWeight > 0.9) {
    _heavyBreathingIntensityInternal = Math.min(1, _heavyBreathingIntensityInternal + deltaTime * 0.001);
  } else {
    _heavyBreathingIntensityInternal = Math.max(0, _heavyBreathingIntensityInternal - deltaTime * 0.0005);
  }
  const effectiveHeavyBreathing = _heavyBreathingIntensityInternal;

  const breathPhase = t * (IDLE_PHYSICS.BREATH_SPEED_BASE + settings.breathing * IDLE_PHYSICS.BREATH_SPEED_FACTOR) * idleSpeed;
  const breathVal = Math.sin(breathPhase);
  const torsoBreathAmp = IDLE_PHYSICS.TORSO_BREATH_AMPLITUDE * (1 + effectiveHeavyBreathing * 2.0);
  const collarBreathAmp = IDLE_PHYSICS.COLLAR_BREATH_AMPLITUDE * (1 + effectiveHeavyBreathing * 1.2);

  const swayPhase = t * (IDLE_PHYSICS.SWAY_SPEED_BASE + settings.weightShift * IDLE_PHYSICS.SWAY_SPEED_FACTOR) * idleSpeed;
  const swayVal = Math.sin(swayPhase + 0.4); 
  
  const posture = settings.posture;
  const torsoBias = posture < 0 ? posture * -15 : posture * -8;
  const collarBias = posture < 0 ? posture * -10 : posture * -8;
  const neckBias = posture < 0 ? posture * -10 : posture * -8;

  // Trait Postural overrides
  const traitTorsoBias = traitBonus('proud', -10) + traitBonus('bold', -5) + traitBonus('anxious', 15);

  const tension = settings.tension * nervousMult;
  let tremor = 0;
  if (tension > 0.01) {
    if (t - _lastTremorUpdateTime > (250 + Math.random() * 250) / idleSpeed) {
      _tremorTarget = (Math.random() * 2 - 1) * 0.8;
      _lastTremorUpdateTime = t;
    }
    _currentTremor = lerp(_currentTremor, _tremorTarget, 0.1);
    tremor = _currentTremor * tension;
  }
  
  const collarHunchYOffset = -tension * 0.06; 
  const shoulderHunchRotation = tension * 6;

  const gazeShiftInterval = (4000 + Math.random() * 4000) / idleSpeed;
  if (t - _lastGazeShiftTime > gazeShiftInterval * (1.5 - settings.gazeSway)) {
    _gazeTargetX = (Math.random() * 2 - 1) * 6 * settings.gazeSway;
    _gazeTargetY = (Math.random() * 2 - 1) * 4 * settings.gazeSway;
    _lastGazeShiftTime = t;
  }
  const gazeProgress = clamp((t - _lastGazeShiftTime) / (800 / idleSpeed), 0, 1);
  _currentGazeX = lerp(_currentGazeX, settings.gazeSway > 0.01 ? _gazeTargetX : 0, gazeProgress);
  _currentGazeY = lerp(_currentGazeY, settings.gazeSway > 0.01 ? _gazeTargetY : 0, gazeProgress);

  const fidgetInterval = (6000 + Math.random() * 6000) / idleSpeed;
  if (t - _lastFidgetShiftTime > fidgetInterval * (1.5 - settings.fidgetFrequency)) {
    _fidgetTargetNeck = (Math.random() * 2 - 1) * 2 * settings.fidgetFrequency;
    _fidgetTargetHand = (Math.random() * 2 - 1) * 1 * settings.fidgetFrequency;
    _lastFidgetShiftTime = t;
  }
  const fidgetProgress = Math.min(1, (t - _lastFidgetShiftTime) / (1000 / idleSpeed));
  _currentFidgetNeck = lerp(_currentFidgetNeck, settings.fidgetFrequency > 0.01 ? _fidgetTargetNeck : 0, fidgetProgress);
  _currentFidgetHand = lerp(_currentFidgetHand, settings.fidgetFrequency > 0.01 ? _fidgetTargetHand : 0, fidgetProgress);

  return {
    torso: torsoBias + traitTorsoBias + breathVal * torsoBreathAmp + swayVal * 2,
    collar: collarBias + breathVal * collarBreathAmp + tremor + _currentGazeY,
    collarYOffset: collarHunchYOffset, 
    [PartName.LShoulder]: 8 * tension + shoulderHunchRotation,
    [PartName.RShoulder]: -8 * tension - shoulderHunchRotation,
    [PartName.LElbow]: 10 * tension,
    [PartName.RElbow]: 10 * tension,
    [PartName.LWrist]: 7.5 * tension + _currentFidgetHand,
    [PartName.RWrist]: 7.5 * tension - _currentFidgetHand,
    [PartName.LKnee]: 5 + breathVal * 0.3,
    [PartName.RKnee]: 5 + breathVal * 0.3,
    [PartName.LThigh]: -8 + swayVal * 8 * settings.weightShift,
    [PartName.RThigh]: 8 + swayVal * 8 * settings.weightShift,
    x_offset: 0,
    y_offset: 0,
    neck: neckBias + _currentGazeX + _currentFidgetNeck,
  };
};
