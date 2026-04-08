
import { 
  WalkingEngineGait, 
  WalkingEnginePose, 
  WalkingEngineProportions, 
  PhysicsControls,
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
  UPPER_BODY_LEAN_MULTIPLIER: 24,
  BODY_ROTATION_MULTIPLIER: 14,
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
  HEAVY_STOMP_BOB_MULTIPLIER: 14,
  FOOT_SPRING_BOB_MULTIPLIER: 10,
  KICK_UP_KNEE_AMPLITUDE: 60,
  KICK_UP_FOOT_AMPLITUDE: 40,
  VERTICALITY_BOB_AMPLITUDE: 12,
  VERTICALITY_GRAVITY_DAMPENING: 0.7,
  HEAD_SPIN_MULTIPLIER: 18,
  HEAD_AUTO_BEND_MULTIPLIER: 10,
  HAND_AUTO_BEND_MULTIPLIER: 12,
  HAND_AUTO_STRETCH_MULTIPLIER: 8,
  FOOT_AUTO_BEND_MULTIPLIER: 10,
  FOOT_AUTO_STRETCH_MULTIPLIER: 6,
} as const;

export interface LocomotionState {
  smoothedWaistTwist: number;
  smoothedTorsoLean: number;
  smoothedWaistSway: number;
  smoothedBodySwayX: number;
  smoothedBobbing: number;
  smoothedLFoot: number;
  smoothedRFoot: number;
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
  smoothedLFoot: -90,
  smoothedRFoot: -90,
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
    const footRel = rotateVecInternal({ x: 0, y: footLen }, angles.foot);
    const tipPos = { x: anklePos.x + footRel.x, y: anklePos.y + footRel.y };

    return tipPos;
};

const smooth01 = (t: number): number => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

const shapePendulum = (value: number, power: number = 0.78): number => {
  return Math.sign(value) * Math.pow(Math.abs(value), power);
};

const calculateLegAngles = (s: number, g: WalkingEngineGait, phase: number, wf: number) => {
  const verticality = clamp(g.verticality, 0, 1);
  const kickUp = clamp(g.kick_up_force, 0, 1);
  const drag = clamp(g.footDrag, 0, 1);
  const stomp = clamp(g.heavyStomp, 0, 1);
  const spring = clamp(g.footSpring, 0, 1);
  const footBend = clamp(g.feetAutoBend, 0, 1);
  const footStretch = clamp(g.feetAutoStretch, 0, 1);
  const toeBend = clamp(g.toe_bend, 0, 1);
  const frequencyEnergy = clamp((g.frequency - 0.1) / 2.0, 0, 1);
  const motionEnergy = clamp(
    0.1
      + (frequencyEnergy * 0.95)
      + (g.intensity * 0.12)
      + (g.stride * 0.08),
    0.1,
    1.35,
  );
  const normalizedPhase = ((phase % (2 * Math.PI)) + (2 * Math.PI)) % (2 * Math.PI);
  const gaitCycle = normalizedPhase / (2 * Math.PI);

  const hipMult = (GAIT_PHYSICS.HIP_BASE_MULTIPLIER + (g.stride * GAIT_PHYSICS.HIP_STRIDE_FACTOR)) * 
                  (GAIT_PHYSICS.HIP_INTENSITY_BASE + g.intensity * GAIT_PHYSICS.HIP_INTENSITY_FACTOR);
  let hip = s * hipMult;
  let knee = 6;
  let foot = -90;

  const isStance = s < 0;
  const cyclePhase = isStance ? gaitCycle : (gaitCycle + 0.5) % 1;
  const toeBias = clamp((g.foot_roll * 0.75) + (kickUp * 0.5) + (spring * 0.2) - (drag * 0.24), 0, 1);
  const initialStrike = lerp(GAIT_PHYSICS.STANCE_TOE_STRIKE_ANGLE, GAIT_PHYSICS.STANCE_HEEL_STRIKE_ANGLE, 1 - toeBias);

  if (isStance) {
    const loading = smooth01((cyclePhase - 0.02) / 0.16);
    const midStance = smooth01((cyclePhase - 0.2) / 0.26);
    const pushOff = smooth01((cyclePhase - 0.58) / 0.26);
    const release = smooth01((cyclePhase - 0.84) / 0.16);
    const gravityBias = clamp(g.gravity * (1 - verticality * GAIT_PHYSICS.VERTICALITY_GRAVITY_DAMPENING), 0, 1);
    const loadBend = (6 + gravityBias * 10 + stomp * 3) * motionEnergy;
    const midBend = lerp(loadBend, 4 + verticality * 4 + spring * 2, midStance);
    const pushOffBend = (8 + kickUp * 8 + spring * 5 + footBend * 2) * motionEnergy;

    knee = lerp(loadBend, midBend, loading);
    knee = lerp(knee, pushOffBend, pushOff);
    knee = lerp(knee, 4 + verticality * 2.5, release);
    knee *= wf;
    knee = clamp(knee, 2, 28);

    const strikeSettle = lerp(initialStrike - toeBend * 3.5, initialStrike * 0.42, midStance);
    const toeRoll = lerp(0, GAIT_PHYSICS.STANCE_TOE_OFF_ANGLE, pushOff)
      * (g.foot_roll * 0.82 + kickUp * 0.2 + spring * 0.2 + toeBend * 0.2);
    const toeFlex = toeBend * GAIT_PHYSICS.TOE_BEND_MAX_ANGLE * (0.08 + release * 0.22);
    const pushOffRoll = smooth01((cyclePhase - 0.44) / 0.18) * (4 + kickUp * 3 + spring * 2 + drag * 2);
    foot += strikeSettle + (toeRoll * 0.48) - toeFlex + stomp * 2.1 - drag * 1.8 + pushOffRoll;
  } else {
    const lift = smooth01(cyclePhase / 0.18);
    const pass = smooth01((cyclePhase - 0.16) / 0.3);
    const reach = smooth01((cyclePhase - 0.58) / 0.32);
    const airFactor = clamp(GAIT_PHYSICS.HOVER_AIR_FACTOR_BASE - (g.gravity * 0.6) + (verticality * 0.35) + (spring * 0.15), 0.15, 1.8);
    const swingCarry = clamp(0.25 + frequencyEnergy * 0.85, 0.25, 1);
    const hLift = g.hover_height * GAIT_PHYSICS.HOVER_HEIGHT_MULTIPLIER * swingCarry * (0.08 + lift * 0.18) * airFactor * (0.35 + verticality * 0.35 + kickUp * 0.2);
    hip -= hLift * (0.3 + lift * 0.14);

    const liftBend = (10 + g.stride * 6 + kickUp * 10 + spring * 4) * swingCarry;
    const passBend = (22 + g.stride * 7 + kickUp * 8) * swingCarry;
    const reachBend = 8 + verticality * 6 + footStretch * 4;
    knee = lerp(liftBend, passBend, pass);
    knee = lerp(knee, reachBend, reach);
    knee = lerp(knee, 10 + verticality * 4, smooth01((cyclePhase - 0.84) / 0.16));
    knee += hLift * 0.06;
    knee += spring * 3.5 * swingCarry;
    knee = clamp(knee, 5, 44);

    const swingLift = kickUp * GAIT_PHYSICS.KICK_UP_FOOT_AMPLITUDE * swingCarry * (0.1 + lift * 0.18);
    const swingFlex = toeBend * GAIT_PHYSICS.TOE_BEND_MAX_ANGLE * (0.08 + lift * 0.22 + pass * 0.06);
    const swingRelax = smooth01((cyclePhase - 0.68) / 0.24) * (toeBend * 3 + footStretch * 2.5);
    const swingSettle = smooth01((cyclePhase - 0.16) / 0.34) * (8 + drag * 3 + footStretch * 2.5);

    foot += swingLift;
    foot -= swingFlex;
    foot += footBend * GAIT_PHYSICS.FOOT_AUTO_BEND_MULTIPLIER * (0.1 + pass * 0.42);
    foot -= footStretch * GAIT_PHYSICS.FOOT_AUTO_STRETCH_MULTIPLIER * reach * (0.2 + pass * 0.22);
    foot += drag * GAIT_PHYSICS.FOOT_DRAG_MAX_ANGLE * (0.04 + pass * 0.12);
    foot += swingRelax * 0.35;
    foot += swingSettle;
  }

  return {
    hip,
    knee,
    foot: clamp(foot, -106, -64),
  };
};

const calculateHandAngle = (
  phase: number,
  elbowAngle: number,
  waistTwist: number,
  gait: WalkingEngineGait,
  isRight: boolean,
) => {
  const phaseLag = isRight ? -0.18 : 0.18;
  const sidePhase = phase + phaseLag + (isRight ? 0 : Math.PI);
  const swing = Math.sin(sidePhase);
  const settle = Math.sin(phase * 0.5 + (isRight ? 0.35 : -0.35));
  const elbowRelax = clamp(Math.abs(elbowAngle) / 120, 0, 1);
  const relaxedNeutral = lerp(16, 7, elbowRelax);
  const swingAmount = 6 + gait.arm_swing * 4;
  const driftAmount = 1.5 + gait.frequency * 1.2;
  const twistCoupling = waistTwist * (isRight ? -0.04 : 0.04);
  const handBend = clamp(gait.handsAutoBend, 0, 1);
  const handStretch = clamp(gait.handsAutoStretch, 0, 1);

  return clamp(
    -relaxedNeutral
      + swing * swingAmount
      + settle * driftAmount
      + twistCoupling
      + (handBend * GAIT_PHYSICS.HAND_AUTO_BEND_MULTIPLIER)
      - (handStretch * GAIT_PHYSICS.HAND_AUTO_STRETCH_MULTIPLIER)
      + (isRight ? -1.5 : 1.5),
    -55,
    30,
  );
};

export const updateLocomotionPhysics = (
  p: number, state: LocomotionState, gait: WalkingEngineGait, physics: PhysicsControls, weightFactor: number = 1.0,
): Partial<WalkingEnginePose> => {
  const g = (k: keyof WalkingEngineGait) => gait[k];

  const stab = physics.stabilization;
  const alpha = 1.0 - stab;
  const sVal = Math.sin(p);
  const cStride = Math.sin(p + Math.PI);
  const upperBodyLean = g('upper_body_lean');
  const verticality = clamp(g('verticality'), 0, 1);
  const kickUp = clamp(g('kick_up_force'), 0, 1);
  const drag = clamp(g('footDrag'), 0, 1);
  const stomp = clamp(g('heavyStomp'), 0, 1);
  const spring = clamp(g('footSpring'), 0, 1);
  const headSpin = g('head_spin');
  const headAutoBend = g('headAutoBend');
  const headAutoStretch = g('headAutoStretch');
  const frequencyEnergy = clamp((g('frequency') - 0.1) / 2.0, 0, 1);
  const motionEnergy = clamp(
    0.1
      + (frequencyEnergy * 0.95)
      + (g('intensity') * 0.12)
      + (g('stride') * 0.08),
    0.1,
    1.35,
  );

  state.smoothedTorsoLean = lerp(
    state.smoothedTorsoLean,
    (g('lean') * GAIT_PHYSICS.BODY_LEAN_MULTIPLIER)
      + (upperBodyLean * GAIT_PHYSICS.UPPER_BODY_LEAN_MULTIPLIER)
      + (sVal * GAIT_PHYSICS.BODY_LEAN_OSCILLATION_AMPLITUDE * g('intensity') * (0.6 + verticality * 0.6)),
    alpha,
  );
  const swayMag = GAIT_PHYSICS.HIP_SWAY_BASE_MAG_MOD * g('hip_sway') * g('intensity');
  state.smoothedBodySwayX = lerp(state.smoothedBodySwayX, sVal * swayMag, alpha);
  state.smoothedWaistSway = lerp(state.smoothedWaistSway, -sVal * swayMag * GAIT_PHYSICS.WAIST_SWAY_RATIO, alpha);
  state.smoothedWaistTwist = lerp(state.smoothedWaistTwist, cStride * (GAIT_PHYSICS.WAIST_TWIST_BASE + g('arm_swing') * GAIT_PHYSICS.WAIST_TWIST_ARM_SWING_BONUS) * g('waist_twist') * g('intensity'), alpha);
  state.smoothedBodyRotation = lerp(
    state.smoothedBodyRotation,
    (upperBodyLean * GAIT_PHYSICS.BODY_ROTATION_MULTIPLIER)
      + (state.smoothedWaistTwist * 0.08)
      + (sVal * (verticality - 0.5) * 8),
    alpha,
  );
  state.smoothedBobbing = lerp(
    state.smoothedBobbing,
    Math.sin(p * 2) * GAIT_PHYSICS.VERTICALITY_BOB_AMPLITUDE * (0.18 + verticality * 0.42)
      - stomp * (GAIT_PHYSICS.HEAVY_STOMP_BOB_MULTIPLIER * 0.45)
      + spring * (GAIT_PHYSICS.FOOT_SPRING_BOB_MULTIPLIER * 0.35)
      - drag * 1.5,
    alpha,
  );
  
  const swingMag = (GAIT_PHYSICS.ARM_SWING_BASE + (g('stride') * GAIT_PHYSICS.ARM_SWING_STRIDE_FACTOR))
    * (GAIT_PHYSICS.ARM_SWING_INTENSITY_BASE + g('intensity') * GAIT_PHYSICS.ARM_SWING_INTENSITY_FACTOR)
    * g('arm_swing')
    * motionEnergy;
  const shoulderSwingEnvelope = clamp(0.74 + (g('frequency') * 0.22) + (g('arm_swing') * 0.16), 0.68, 1.28);
  const shoulderArcL = shapePendulum(cStride);
  const shoulderArcR = shapePendulum(sVal);
  
  const baseFlexion = lerp(GAIT_PHYSICS.ELBOW_WALK_BASE, GAIT_PHYSICS.ELBOW_RUN_BASE, clamp((g('intensity') - 0.4) * 1.5, 0, 1))
    * g('elbow_bend')
    * motionEnergy;
  const lagL = p + Math.PI - GAIT_PHYSICS.ELBOW_LAG_RADIANS;
  const lagR = p - GAIT_PHYSICS.ELBOW_LAG_RADIANS;
  
  const getElbow = (lag: number) => {
    const sinLag = Math.sin(lag);
    const flex = Math.max(0, sinLag) * (22 + g('intensity') * 22) * motionEnergy;
    const ext = Math.min(0, sinLag) * (10 + g('intensity') * 10) * motionEnergy;
    const elbowFlex = 0.45 + g('elbowFlexibility') * 1.1;
    const minBend = clamp(g('elbowMinBend'), -160, -5);
    const maxBend = clamp(g('elbowMaxBend'), 5, 155);
    // Anatomical Bias: Elbows flex ANTERIORLY (negative rotation in this coordinate frame)
    // Hyper-extension is limited to -5 to 155 flexion.
    return clamp(-(baseFlexion + (flex + ext) * elbowFlex), minBend, maxBend);
  };

  state.smoothedLElbow = lerp(state.smoothedLElbow, getElbow(lagL), alpha);
  state.smoothedRElbow = lerp(state.smoothedRElbow, getElbow(lagR), alpha);

  const lLeg = calculateLegAngles(sVal, gait, p, weightFactor);
  const rLeg = calculateLegAngles(cStride, gait, p + Math.PI, weightFactor);
  const footAlpha = clamp(alpha * 1.4 + 0.08, 0, 1);
  state.smoothedLFoot = lerp(state.smoothedLFoot, lLeg.foot, footAlpha);
  state.smoothedRFoot = lerp(state.smoothedRFoot, rLeg.foot, footAlpha);

  const tTwist = -state.smoothedWaistTwist * (GAIT_PHYSICS.TORSO_COUNTER_TWIST_BASE + g('torso_swivel') * GAIT_PHYSICS.TORSO_COUNTER_TWIST_SWIVEL_RANGE);
  const finalTorso = state.smoothedTorsoLean + tTwist + state.smoothedWaistSway + (upperBodyLean * 8);
  const finalCollar = (state.smoothedTorsoLean * -GAIT_PHYSICS.COLLAR_LEAN_COMPENSATION) + (state.smoothedWaistSway * -GAIT_PHYSICS.COLLAR_SWAY_COMPENSATION) + (tTwist * -0.5) + (upperBodyLean * 5);
  const finalNeck = state.smoothedTorsoLean * -GAIT_PHYSICS.NECK_LEAN_COMPENSATION + (headSpin * GAIT_PHYSICS.HEAD_SPIN_MULTIPLIER) + (headAutoBend * GAIT_PHYSICS.HEAD_AUTO_BEND_MULTIPLIER) - (headAutoStretch * 4);
  const lHand = calculateHandAngle(p, state.smoothedLElbow, state.smoothedWaistTwist, gait, false);
  const rHand = calculateHandAngle(p, state.smoothedRElbow, state.smoothedWaistTwist, gait, true);

  return {
    x_offset: state.smoothedBodySwayX,
    y_offset: state.smoothedBobbing,
    stride_phase: ((p / (Math.PI * 2)) % 1 + 1) % 1,
    bodyRotation: state.smoothedBodyRotation,
    waist: state.smoothedWaistTwist,
    torso: finalTorso,
    collar: finalCollar,
    neck: finalNeck,
    l_shoulder: shoulderArcL * swingMag * shoulderSwingEnvelope - g('arm_spread') * GAIT_PHYSICS.ARM_SPREAD_ANGLE,
    r_shoulder: shoulderArcR * swingMag * shoulderSwingEnvelope + g('arm_spread') * GAIT_PHYSICS.ARM_SPREAD_ANGLE,
    l_elbow: state.smoothedLElbow,
    r_elbow: state.smoothedRElbow,
    l_hand: lHand,
    r_hand: rHand,
    l_hip: lLeg.hip, l_knee: lLeg.knee, l_foot: state.smoothedLFoot,
    r_hip: rLeg.hip, r_knee: rLeg.knee, r_foot: state.smoothedRFoot,
  };
};
