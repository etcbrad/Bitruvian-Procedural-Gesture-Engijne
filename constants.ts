
import { PartName, Vector2D, JointLimits, IdleSettings, WalkingEnginePose } from './types';

export const SCALE_FACTOR = 1; 
export const BASE_HEAD_UNIT = 50; 

export const ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT = {
  HEAD: 0.75, 
  HEAD_WIDTH: (2 / 3) * 0.5, 
  HEAD_NECK_GAP_OFFSET: 0.1,
  COLLAR: 0.4, 
  COLLAR_WIDTH: (2 / 3), 
  TORSO: 1.2, 
  TORSO_WIDTH: 0.65, 
  WAIST: 1.0, 
  WAIST_WIDTH: 0.85, 
  UPPER_ARM: 1.8, 
  LOWER_ARM: 1.4, 
  HAND: 0.8, 
  LEG_UPPER: 2.2, 
  LEG_LOWER: 1.8, 
  FOOT: 0.9, 
  SHOULDER_WIDTH: 1.2, 
  HIP_WIDTH: 1.0, 
  ROOT_SIZE: 0.25,
  LIMB_WIDTH_ARM: 0.22, 
  LIMB_WIDTH_FOREARM: 0.18, 
  LIMB_WIDTH_THIGH: 0.45, 
  LIMB_WIDTH_CALF: 0.18, 
  HAND_WIDTH: 0.2, 
  FOOT_WIDTH: 0.25, 
  EFFECTOR_WIDTH: 0.15,
};

export const RIGGING = {
  L_SHOULDER_X_OFFSET_FROM_COLLAR_CENTER: -ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.COLLAR_WIDTH / 2.1,
  R_SHOULDER_X_OFFSET_FROM_COLLAR_CENTER: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.COLLAR_WIDTH / 2.1,
  SHOULDER_Y_OFFSET_FROM_COLLAR_END: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.COLLAR,
  COLLAR_OFFSET_Y: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.COLLAR * 0.15,
};

export const MANNEQUIN_LOCAL_FLOOR_Y = 
    ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LEG_UPPER + 
    ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LEG_LOWER +
    ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.FOOT;

export const CUTOUT_GAP_SIZE = 5; 

export const GROUND_STRIP_COLOR = '#F3F4F6'; 
export const GROUND_STRIP_HEIGHT_RAW_H_UNIT = 0.05; 

export const TIMING = {
  DEFAULT_TARGET_FPS: 60,
  PAUSE_TRANSITION_DURATION: 1000,
  MODE_TRANSITION_DURATION: 500, 
};

export const UI = {
  DEFAULT_ZOOM_INDEX: 4,
  ZOOM_LEVELS: [0.1, 0.2, 0.35, 0.5, 0.75, 1, 1.25, 1.5, 2.0, 3.0, 4.0],
  BASE_VIEWBOX: { x: -500, y: -1100, width: 1000, height: 1000 },
};

export const IDLE_PHYSICS = {
  BREATH_SPEED_BASE: 0.00015, // Calibrated for resting human heart rate
  BREATH_SPEED_FACTOR: 0.04,
  TORSO_BREATH_AMPLITUDE: 1.2,
  COLLAR_BREATH_AMPLITUDE: 0.8,
  HEAVY_BREATH_TORSO_MULTIPLIER: 2.5,
  HEAVY_BREATH_COLLAR_MULTIPLIER: 1.5,
  KNEE_BREATH_AMPLITUDE: 0.2,
  SWAY_SPEED_BASE: 0.0002,
  SWAY_SPEED_FACTOR: 0.06,
  SWAY_PHASE_OFFSET: Math.PI * 0.5,
  BODY_SWAY_AMPLITUDE: 10,
  TORSO_SWAY_AMPLITUDE: 3,
  X_SWAY_AMPLITUDE: 5,
  GAZE_SHIFT_INTERVAL_MIN: 3000,
  GAZE_SHIFT_INTERVAL_MAX: 9000,
  GAZE_TRANSITION_DURATION: 1200,
  GAZE_AMPLITUDE_MAX_X: 10,
  GAZE_AMPLITUDE_MAX_Y: 5,
  FIDGET_SHIFT_INTERVAL_MIN: 5000,
  FIDGET_SHIFT_INTERVAL_MAX: 15000,
  FIDGET_TRANSITION_DURATION: 1500,
  FIDGET_SPEED_BASE: 0.0008,
  NECK_FIDGET_AMPLITUDE: 4,
  HAND_FIDGET_AMPLITUDE: 2,
  TENSION_SHOULDER_RAISE: 12,
  TENSION_ELBOW_TIGHTEN: 15,
  TENSION_HAND_CLENCH: 20,
  TENSION_TREMOR_AMPLITUDE: 1.2,
  TENSION_TREMOR_SPEED: 0.012,
  TENSION_COLLAR_HUNNCH_Y_OFFSET_FACTOR: 0.08,
  TENSION_SHOULDER_INWARD_ROTATION: 8,
  TREMOR_UPDATE_INTERVAL_MIN: 150,
  TREMOR_UPDATE_INTERVAL_MAX: 400,
  TREMOR_SMOOTHING_FACTOR: 0.15,
  POSTURE_TORSO_SLUMPED: 18,
  POSTURE_TORSO_HEROIC: -12,
  POSTURE_COLLAR_SLUMPED: 14,
  POSTURE_COLLAR_HEROIC: -10,
  POSTURE_NECK_SLUMPED: 12,
  POSTURE_NECK_HEROIC: -10,
  DEFAULT_HIP_SPREAD: 12,
  DEFAULT_KNEE_BEND: 8,
  MAX_SPEED_DAMPENING_FACTOR: 1.8,
};

export const GROUNDING_PHYSICS = {
  FLOOR_Y_OFFSET_GLOBAL_H_UNIT: MANNEQUIN_LOCAL_FLOOR_Y,
  FOOT_LIFT_THRESHOLD_H_UNIT: 0.015, // Sharper contact threshold
  GROUNDING_SPRING_FACTOR: 0.25, // Snappier grounding
  GROUNDING_X_STABILITY_FACTOR: 0.15,
  COG_X_CENTER_OFFSET_H_UNIT: 0,
  COG_X_SIDE_OFFSET_H_UNIT: 0.08, // Better balance bias
  COG_Y_BIAS_H_UNIT: 0.03,
  MASS_INFLUENCE_FACTOR: 0.6,
  ELASTICITY_INFLUENCE_FACTOR: 0.85,
  STABILIZATION_INFLUENCE_FACTOR: 0.75,
  STABILITY_SPRING_BASE_SPREAD_H_UNIT: 0.18,
  STABILITY_SPRING_CROUCH_SPREAD_H_UNIT: 0.45,
  VERTICALITY_TENSION_THRESHOLD: 0.9,
  VERTICALITY_STRAIGHTEN_FACTOR: 0.4,
  GRAVITY_OVERLOAD_KNEE_BEND_THRESHOLD: 100, // Trigger earlier crouch centering
  GRAVITY_OVERLOAD_CENTERING_FACTOR: 0.5,
};

export const DEFAULT_RESTING_POSE: WalkingEnginePose = { 
  bodyRotation: 0, waist: 0, neck: 0, collar: 0, torso: 0, 
  l_shoulder: 15, r_shoulder: -15, 
  l_elbow: -10, r_elbow: -10, 
  l_hand: 0, r_hand: 0, 
  l_hip: 0, r_hip: 0, 
  l_knee: 10, r_knee: 10, 
  l_foot: -90, r_foot: -90, stride_phase: 0, y_offset: 0, x_offset: 0 
};

export const DEFAULT_IDLE_SETTINGS: IdleSettings = { 
  breathing: 0.4, weightShift: 0.2, gazeSway: 0.3, tension: 0.1, fidgetFrequency: 0.2, 
  transitionSpeed: 0.3, posture: 0.0, idlePinnedFeet: 'none' 
};

export const DEFAULT_PIVOT_OFFSETS = { 
  neck: 0, collar: 0, torso: 0, waist: 0, 
  l_shoulder: 0, r_shoulder: 0, l_elbow: 0, r_elbow: 0, l_hand: 0, r_hand: 0, 
  l_hip: 0, r_hip: 0, l_knee: 0, r_knee: 0, l_foot: 0, r_foot: 0 
};

export const DEFAULT_PROPORTIONS = { 
  head: { w: 1, h: 1 }, collar: { w: 1, h: 1 }, torso: { w: 1, h: 1 }, waist: { w: 1, h: 1 }, 
  l_upper_arm: { w: 1, h: 1 }, l_lower_arm: { w: 1, h: 1 }, l_hand: { w: 1, h: 1 }, 
  r_upper_arm: { w: 1, h: 1 }, r_lower_arm: { w: 1, h: 1 }, r_hand: { w: 1, h: 1 }, 
  l_upper_leg: { w: 1, h: 1 }, l_lower_leg: { w: 1, h: 1 }, l_foot: { w: 1, h: 1 }, 
  r_upper_leg: { w: 1, h: 1 }, r_lower_leg: { w: 1, h: 1 }, r_foot: { w: 1, h: 1 } 
};

export const DEFAULT_PHYSICS = { 
  motionSmoothing: 0.85, jointElasticity: 0.8, stabilization: 0.75, 
  impactDamping: 0.2, bodyMass: 0.5, pendulumDrag: 0.3, bounceIntensity: 0.5 
};

export const DEFAULT_LOTTE_SETTINGS = { 
  enabled: false, frameStepping: true, cutoutSnap: true, 
  paperJitter: true, shadowBlur: false, profileLock: false 
};

export const JOINT_LIMITS: JointLimits = {
  [PartName.Waist]: { min: -180, max: 180 }, 
  [PartName.Torso]: { min: -180, max: 180 },
  [PartName.Collar]: { min: -180, max: 180 },
  [PartName.Head]: { min: -180, max: 180 },
  [PartName.RShoulder]: { min: -180, max: 180 }, 
  [PartName.RElbow]: { min: -180, max: 180 },         
  [PartName.RWrist]: { min: -180, max: 180 }, 
  [PartName.LShoulder]: { min: -180, max: 180 }, 
  [PartName.LElbow]: { min: -180, max: 180 },          
  [PartName.LWrist]: { min: -180, max: 180 }, 
  [PartName.RThigh]: { min: -180, max: 180 }, 
  [PartName.RKnee]: { min: -180, max: 180 },           
  [PartName.RAnkle]: { min: -180, max: 180 }, 
  [PartName.LThigh]: { min: -180, max: 180 },
  [PartName.LKnee]: { min: -180, max: 180 },
  [PartName.LAnkle]: { min: -180, max: 180 },
};
