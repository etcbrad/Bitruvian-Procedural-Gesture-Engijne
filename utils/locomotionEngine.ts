
import { 
  WalkingEngineGait, 
  WalkingEnginePose, 
  WalkingEngineProportions, 
  PhysicsControls,
  PartName,
  Vector2D,
} from '../types';
import { 
  lerp, 
  clamp,
} from './kinematics';
import { ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT } from '../constants';

export const GAIT_PHYSICS = {
  HIP_SWAY_BASE_MAG_MOD: 25,
  BODY_LEAN_MULTIPLIER: 35,
  BODY_LEAN_OSCILLATION_AMPLITUDE: 8,
  WAIST_SWAY_RATIO: 0.3,
  WAIST_TWIST_BASE: 60,
  WAIST_TWIST_ARM_SWING_BONUS: 20,
  TORSO_COUNTER_TWIST_BASE: 0.3,
  TORSO_COUNTER_TWIST_SWIVEL_RANGE: 0.7,
  COLLAR_LEAN_COMPENSATION: 0.7,
  COLLAR_SWAY_COMPENSATION: 0.6,
  NECK_LEAN_COMPENSATION: 0.2,
  ARM_SWING_BASE: 20,
  ARM_SWING_STRIDE_FACTOR: 45,
  ARM_SWING_INTENSITY_BASE: 0.5,
  ARM_SWING_INTENSITY_FACTOR: 0.5,
  ARM_SPREAD_ANGLE: 40,
  ELBOW_LAG_RADIANS: 0.4, 
  ELBOW_WALK_BASE: 25,
  ELBOW_RUN_BASE: 90,
  ELBOW_SNEAK_BASE: 115,
  WRIST_DRAG_FACTOR: 35,
  WRIST_FLICK_INTENSITY: 50,
  HIP_BASE_MULTIPLIER: 10,
  HIP_STRIDE_FACTOR: 45,
  HIP_INTENSITY_BASE: 0.8,
  HIP_INTENSITY_FACTOR: 0.4,
  STANCE_KNEE_GRAVITY_FACTOR: 55,
  SWING_KNEE_BASE_FACTOR: 30,
  SWING_KNEE_HOVER_RATIO: 0.75,
  IK_KNEE_GRAVITY_BONUS: 8,
  STANCE_HEEL_STRIKE_ANGLE: 15,
  STANCE_TOE_STRIKE_ANGLE: 7.5,
  STANCE_TOE_OFF_ANGLE: -75,
  SWING_FOOT_DORSIFLEXION: -20,
  SWING_FOOT_GRAVITY_FACTOR: 0.5,
  FOOT_DRAG_MAX_ANGLE: -45, 
  TOE_BREAK_THRESHOLD_FACTOR: -30,
  TOE_BEND_MAX_ANGLE: 45,
  TOE_KICK_BONUS: 40,
  HOVER_HEIGHT_MULTIPLIER: 80,
  HOVER_AIR_FACTOR_BASE: 1.2,
  KICK_UP_KNEE_AMPLITUDE: 60,
  KICK_UP_FOOT_AMPLITUDE: 40,
  VERTICALITY_BOB_AMPLITUDE: 25,
  VERTICALITY_GRAVITY_DAMPENING: 0.7,
} as const;

export interface LocomotionState {
  smoothedWaistTwist: number;
  smoothedTorsoLean: number;
  smoothedWaistSway: number;
  smoothedBodySwayX: number;
  smoothedBobbing: number;
  smoothedLKnee: number;
  smoothedRKnee: number;
  smoothedLElbow: number;
  smoothedRElbow: number;
  smoothedLWrist: number;
  smoothedRWrist: number;
  smoothedBodyRotation: number;
  prevYOffset: number;
}

export const INITIAL_LOCOMOTION_STATE: LocomotionState = {
  smoothedWaistTwist: 0,
  smoothedTorsoLean: 0,
  smoothedWaistSway: 0,
  smoothedBodySwayX: 0,
  smoothedBobbing: 0,
  smoothedLKnee: 0,
  smoothedRKnee: 0,
  smoothedLElbow: 0,
  smoothedRElbow: 0,
  smoothedLWrist: 0,
  smoothedRWrist: 0,
  smoothedBodyRotation: 0,
  prevYOffset: 0,
};

const rotateVecInternal = (vec: Vector2D, angleDeg: number): Vector2D => {
  const r = angleDeg * Math.PI / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: vec.x * c - vec.y * s, y: vec.x * s + vec.y * c };
};

export const calculateFootTipGlobalPosition = (
    angles: { hip: number; knee: number; foot: number },
    props: WalkingEngineProportions,
    baseUnitH: number,
    isRight: boolean
): Vector2D => {
    const thighKey = isRight ? 'r_upper_leg' : 'l_upper_leg';
    const calfKey = isRight ? 'r_lower_leg' : 'l_lower_leg';
    const footKey = isRight ? 'r_foot' : 'l_foot';

    const thighLen = (props[thighKey]?.h ?? 1) * ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LEG_UPPER * baseUnitH;
    const calfLen = (props[calfKey]?.h ?? 1) * ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LEG_LOWER * baseUnitH;
    const footLen = (props[footKey]?.h ?? 1) * ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.FOOT * baseUnitH;
    
    const kneePos = rotateVecInternal({x: 0, y: thighLen}, angles.hip);
    const ankleRel = rotateVecInternal({x: 0, y: calfLen}, angles.hip + angles.knee);
    const anklePos = { x: kneePos.x + ankleRel.x, y: kneePos.y + ankleRel.y };
    const tipPos = anklePos;

    return tipPos;
};

const calculateLegAngles = (s: number, g: WalkingEngineGait, phase: number, wf: number) => {
  const hipMult = (GAIT_PHYSICS.HIP_BASE_MULTIPLIER + (g.stride * GAIT_PHYSICS.HIP_STRIDE_FACTOR)) * 
                  (GAIT_PHYSICS.HIP_INTENSITY_BASE + g.intensity * GAIT_PHYSICS.HIP_INTENSITY_FACTOR);
  let hip = s * hipMult;
  let knee = 5; 
  let foot = -90;
  
  const stanceThreshold = -Math.max(0, (g.intensity - 1.0) * 0.4);
  const normalizedPhase = ((phase % (2 * Math.PI)) + (2 * Math.PI)) % (2 * Math.PI);

  if (s < stanceThreshold) {
    const stanceProgress = normalizedPhase > Math.PI ? (normalizedPhase - Math.PI) / Math.PI : 0;
    knee = g.gravity * GAIT_PHYSICS.STANCE_KNEE_GRAVITY_FACTOR * (1 - Math.sin(stanceProgress * Math.PI)) * wf;
    // Knee flexion: Posterior (positive in clockwise frame for downward limbs)
    knee = clamp(knee, 2, 160);
    
    if (stanceProgress < 0.15) { 
      const t = stanceProgress / 0.15; 
      foot += lerp(GAIT_PHYSICS.STANCE_HEEL_STRIKE_ANGLE, 0, t); 
    } 
    else if (stanceProgress > 0.6) { 
      const t = (stanceProgress - 0.6) / 0.4; 
      foot += lerp(0, GAIT_PHYSICS.STANCE_TOE_OFF_ANGLE, t) * (g.foot_roll + g.kick_up_force * 0.1); 
    }
  } else {
    const swingArc = Math.sin(s * Math.PI); 
    const airFactor = GAIT_PHYSICS.HOVER_AIR_FACTOR_BASE - g.gravity;
    const hLift = g.hover_height * GAIT_PHYSICS.HOVER_HEIGHT_MULTIPLIER * swingArc * airFactor;
    hip -= hLift;
    knee = ((g.stride + g.intensity) * GAIT_PHYSICS.SWING_KNEE_BASE_FACTOR * airFactor) + hLift * GAIT_PHYSICS.SWING_KNEE_HOVER_RATIO;
    knee = clamp(knee, 10, 140);
  }
  return { hip, knee, foot };
};

export const updateLocomotionPhysics = (
  p: number, state: LocomotionState, gait: WalkingEngineGait, physics: PhysicsControls, props: WalkingEngineProportions, activePins: string[], pinnedSlideOffset: number, gravityCenter: 'left' | 'center' | 'right', baseUnitH: number, isIkEnabled: boolean, weightFactor: number = 1.0, 
  gaitEnabled?: Record<string, boolean>
): Partial<WalkingEnginePose> => {
  // Use gaitEnabled to zero out influence of specific factors if needed
  const g = (k: keyof WalkingEngineGait) => (gaitEnabled && gaitEnabled[k] === false) ? 0 : gait[k];

  const stab = physics.stabilization;
  const alpha = 1.0 - stab;
  const sVal = Math.sin(p);
  const cStride = Math.sin(p + Math.PI);

  state.smoothedTorsoLean = lerp(state.smoothedTorsoLean, (g('lean') * GAIT_PHYSICS.BODY_LEAN_MULTIPLIER) + (sVal * GAIT_PHYSICS.BODY_LEAN_OSCILLATION_AMPLITUDE * g('intensity')), alpha);
  const swayMag = GAIT_PHYSICS.HIP_SWAY_BASE_MAG_MOD * g('hip_sway') * g('intensity');
  state.smoothedBodySwayX = lerp(state.smoothedBodySwayX, sVal * swayMag, alpha);
  state.smoothedWaistSway = lerp(state.smoothedWaistSway, -sVal * swayMag * GAIT_PHYSICS.WAIST_SWAY_RATIO, alpha);
  state.smoothedWaistTwist = lerp(state.smoothedWaistTwist, cStride * (GAIT_PHYSICS.WAIST_TWIST_BASE + g('arm_swing') * GAIT_PHYSICS.WAIST_TWIST_ARM_SWING_BONUS) * g('waist_twist') * g('intensity'), alpha);
  
  const swingMag = (GAIT_PHYSICS.ARM_SWING_BASE + (g('stride') * GAIT_PHYSICS.ARM_SWING_STRIDE_FACTOR)) * (GAIT_PHYSICS.ARM_SWING_INTENSITY_BASE + g('intensity') * GAIT_PHYSICS.ARM_SWING_INTENSITY_FACTOR) * g('arm_swing');
  
  const baseFlexion = lerp(GAIT_PHYSICS.ELBOW_WALK_BASE, GAIT_PHYSICS.ELBOW_RUN_BASE, clamp((g('intensity') - 0.4) * 1.5, 0, 1)) * g('elbow_bend');
  const lagL = p + Math.PI - GAIT_PHYSICS.ELBOW_LAG_RADIANS;
  const lagR = p - GAIT_PHYSICS.ELBOW_LAG_RADIANS;
  
  const getElbow = (lag: number) => {
    const sinLag = Math.sin(lag);
    const flex = Math.max(0, sinLag) * (40 + g('intensity') * 30);
    const ext = Math.min(0, sinLag) * (15 + g('intensity') * 15);
    // Anatomical Bias: Elbows flex ANTERIORLY (negative rotation in this coordinate frame)
    // Hyper-extension is limited to -5 to 155 flexion.
    return clamp(-(baseFlexion + (flex + ext) * g('elbowFlexibility')), -155, 5);
  };

  state.smoothedLElbow = lerp(state.smoothedLElbow, getElbow(lagL), alpha);
  state.smoothedRElbow = lerp(state.smoothedRElbow, getElbow(lagR), alpha);

  const lLeg = calculateLegAngles(sVal, gait, p, weightFactor);
  const rLeg = calculateLegAngles(cStride, gait, p + Math.PI, weightFactor);

  const tTwist = -state.smoothedWaistTwist * (GAIT_PHYSICS.TORSO_COUNTER_TWIST_BASE + g('torso_swivel') * GAIT_PHYSICS.TORSO_COUNTER_TWIST_SWIVEL_RANGE);
  const finalTorso = state.smoothedTorsoLean + tTwist + state.smoothedWaistSway;
  const finalCollar = (state.smoothedTorsoLean * -GAIT_PHYSICS.COLLAR_LEAN_COMPENSATION) + (state.smoothedWaistSway * -GAIT_PHYSICS.COLLAR_SWAY_COMPENSATION) + (tTwist * -0.5);
  const finalNeck = state.smoothedTorsoLean * -GAIT_PHYSICS.NECK_LEAN_COMPENSATION + g('head_spin');

  return {
    x_offset: state.smoothedBodySwayX,
    y_offset: 0,
    bodyRotation: state.smoothedBodyRotation,
    waist: state.smoothedWaistTwist,
    torso: finalTorso,
    collar: finalCollar,
    neck: finalNeck,
    l_shoulder: cStride * swingMag - g('arm_spread') * GAIT_PHYSICS.ARM_SPREAD_ANGLE,
    r_shoulder: sVal * swingMag + g('arm_spread') * GAIT_PHYSICS.ARM_SPREAD_ANGLE,
    l_elbow: state.smoothedLElbow,
    r_elbow: state.smoothedRElbow,
    l_hand: Math.cos(p + Math.PI) * GAIT_PHYSICS.WRIST_DRAG_FACTOR,
    r_hand: Math.cos(p) * GAIT_PHYSICS.WRIST_DRAG_FACTOR,
    l_hip: lLeg.hip, l_knee: lLeg.knee, l_foot: lLeg.foot,
    r_hip: rLeg.hip, r_knee: rLeg.knee, r_foot: rLeg.foot,
  };
};
