
export type Vector2D = { x: number; y: number; };

export type Pose = {
  root: Vector2D;
  bodyRotation: number;
  waist: number;
  torso: number;
  collar: number;
  head: number;
  lShoulder: number;
  lForearm: number;
  lWrist: number;
  rShoulder: number;
  rForearm: number;
  rWrist: number;
  lThigh: number;
  lCalf: number;
  lAnkle: number;
  rThigh: number;
  rCalf: number;
  rAnkle: number;
  lToe: number;
  rToe: number;
  offsets?: Partial<Record<PartName, Vector2D>>;
};

export type WalkingEnginePose = {
  bodyRotation: number;
  waist: number;
  neck: number; collar: number; torso: number;
  l_shoulder: number; r_shoulder: number;
  l_elbow: number; r_elbow: number;
  l_hand: number; r_hand: number;
  l_hip: number; r_hip: number;
  l_knee: number; r_knee: number;
  l_foot: number; r_foot: number;
  stride_phase: number;
  y_offset: number;
  x_offset: number;
  collarYOffset?: number;
};

export type GhostState = {
  enabled: boolean;
  pinToManual: boolean;
  opacity: number;
};

export type GaitMode = 'poser' | 'walk' | 'jog' | 'run' | 'chaos';

export type WalkingEngineGait = {
  intensity: number;
  frequency: number;
  stride: number;
  lean: number;
  upper_body_lean: number;
  hip_sway: number;
  waist_twist: number;
  arm_swing: number;
  elbow_bend: number;
  gravity: number;
  verticality: number;
  kick_up_force: number;
  foot_roll: number;
  hover_height: number;
  toe_bend: number;
  torso_swivel: number;
  head_spin: number;
  footDrag: number;
  footSpring: number;
  headAutoBend: number;
  headAutoStretch: number;
  handsAutoBend: number;
  handsAutoStretch: number;
  feetAutoBend: number;
  feetAutoStretch: number;
  heavyStomp: number;
  headVelocitySensitivity: number;
  elbowFlexibility: number;
  elbowMinBend: number;
  elbowMaxBend: number;
  arm_spread: number;
};

// Generative Gait System Types
export type CharacterMorphology = {
  id: string;
  name: string;
  type: 'biped' | 'quadruped' | 'creature' | 'abstract';
  anatomy: {
    limbCount: number;
    limbPairs: { name: string; type: 'leg' | 'arm' | 'wing' | 'fin' | 'tentacle'; count: number }[];
    centerOfMass: number;
    bodyLength: number;
    limbLength: number;
    symmetry: 'bilateral' | 'radial' | 'asymmetric';
  };
  gaitDNA: GaitGenome;
  constraints: {
    maxSpeed: number;
    minSpeed: number;
    maxTurnRate: number;
    legStepHeight: number;
    footClearance: number;
    strikeType: 'heel' | 'toe' | 'flat' | 'midfoot';
  };
  description: string;
  tags: string[];
  generatedFrom?: string;
};

export type GaitGenome = {
  stride: GaitParameter;
  frequency: GaitParameter;
  amplitude: GaitParameter;
  phaseLags: number[];
  footFall: 'quadrupedal' | 'diagonal' | 'lateral' | 'ripple' | 'pronking' | 'galloping';
  bodyRoll: GaitParameter;
  bodyPitch: GaitParameter;
  bodyBounce: GaitParameter;
  ankleFlexion: GaitParameter;
  kneeFlexion: GaitParameter;
  hipSwing: GaitParameter;
  shoulderSwing: GaitParameter;
  energyCost: number;
  stability: number;
  agility: number;
  idleMovement: number;
  anxiousness: number;
  confidence: number;
  weight: number;
};

export type GaitParameter = {
  base: number;
  speed: number;
  variance: number;
  responsiveness: number;
};

export type TextualCharacterDescription = {
  text: string;
  extracted: {
    size: 'tiny' | 'small' | 'medium' | 'large' | 'massive';
    weight: 'light' | 'normal' | 'heavy' | 'massive';
    limbType: string;
    limbCount?: number;
    behavior: string[];
    mood: string[];
    specialAbilities: string[];
    symmetry: 'bilateral' | 'radial' | 'asymmetric';
  };
};

export type IdleSettings = {
  breathing: number;
  weightShift: number;
  gazeSway: number;
  tension: number;
  fidgetFrequency: number;
  transitionSpeed: number;
  posture: number;
  idlePinnedFeet: 'left' | 'right' | 'both' | 'none';
};

export type LotteSettings = {
  enabled: boolean;
  frameStepping: boolean;
  cutoutSnap: boolean;
  paperJitter: boolean;
  shadowBlur: boolean;
  profileLock: boolean;
};

export type PhysicsControls = {
  motionSmoothing: number;
  jointElasticity: number;
  stabilization: number;
  impactDamping: number;
  bodyMass: number;
  pendulumDrag: number;
  bounceIntensity: number;
};

export type WalkingEnginePivotOffsets = {
  neck: number; collar: number; torso: number; waist: number;
  l_shoulder: number; r_shoulder: number;
  l_elbow: number; r_elbow: number;
  l_hand: number; r_hand: number;
  l_hip: number; r_hip: number;
  l_knee: number; r_knee: number;
  l_foot: number; r_foot: number;
};

export type JointModesState = Partial<Record<keyof WalkingEnginePivotOffsets, { isBend: boolean; isStretch: boolean }>>;

export enum PartName {
  Waist = 'waist',
  Torso = 'torso',
  Collar = 'collar',
  Head = 'neck',
  RShoulder = 'r_shoulder',
  RElbow = 'r_elbow',
  RWrist = 'r_hand',
  LShoulder = 'l_shoulder',
  LElbow = 'l_elbow',
  LWrist = 'l_hand',
  RThigh = 'r_hip',
  RKnee = 'r_knee',
  RAnkle = 'r_foot',
  LThigh = 'l_hip',
  LKnee = 'l_knee',
  LAnkle = 'l_foot',
}

export type EasingType = 'linear' | 'easeInOutQuint' | 'easeInQuad' | 'easeOutQuad' | 'easeInOutCubic';

export type WalkKeyPoseId = 'contact' | 'down' | 'passing' | 'up';

export type WalkKeyPoseCycleBeat = {
  id: string;
  label: string;
  phase: number;
};

export type WalkKeyPoseCycleSeed = {
  source: 'generated-cycle';
  sampledAtPhase: number;
  helperBeats: WalkKeyPoseCycleBeat[];
};

export type WalkKeyPoseAnchor = {
  id: WalkKeyPoseId;
  phase: number;
  easing: EasingType;
  mirror: boolean;
  authored: boolean;
  pose: WalkingEnginePose;
  cyclePose: WalkingEnginePose;
};

export type WalkKeyPoseSet = {
  selectedAnchorId: WalkKeyPoseId;
  anchors: Record<WalkKeyPoseId, WalkKeyPoseAnchor>;
  cycleSeed: WalkKeyPoseCycleSeed;
};

export type PoseLibraryCategory = 'Base' | 'Action' | 'Dance' | 'Still' | 'Character';

export type PoseLibraryEntry = {
  id: string;
  cat: PoseLibraryCategory;
  name: string;
  src: string;
  data: string;
  pose: WalkingEnginePose;
  phaseHint: number;
  mirrored?: boolean;
  sourceId?: string;
};

export type Keyframe = {
  time: number;
  pose: WalkingEnginePose;
  gait: Partial<WalkingEngineGait>;
  easing: EasingType;
};

export type AnimationClip = {
  id: string;
  name: string;
  duration: number;
  keyframes: Keyframe[];
  loop: boolean;
};

export type AnimationState = {
  currentClip: AnimationClip | null;
  currentTime: number;
  isPlaying: boolean;
  speed: number;
};

// Behavioral Micro-Scripts
export type MicroScriptInstance = {
  id: string;
  scriptId: string;
  startTime: number;
  weight: number;
  duration: number;
};

export const partNameToPoseKey: Record<PartName, keyof Pose> = {
  [PartName.Waist]: 'waist',
  [PartName.Torso]: 'torso',
  [PartName.Collar]: 'collar',
  [PartName.Head]: 'head',
  [PartName.LShoulder]: 'lShoulder',
  [PartName.LElbow]: 'lForearm',
  [PartName.LWrist]: 'lWrist',
  [PartName.RShoulder]: 'rShoulder',
  [PartName.RElbow]: 'rForearm',
  [PartName.RWrist]: 'rWrist',
  [PartName.LThigh]: 'lThigh',
  [PartName.LKnee]: 'lCalf',
  [PartName.LAnkle]: 'lAnkle',
  [PartName.RThigh]: 'rThigh',
  [PartName.RKnee]: 'rCalf',
  [PartName.RAnkle]: 'rAnkle',
};

export type ProportionDimension = { w: number; h: number };
export type WalkingEngineProportions = {
  head: ProportionDimension;
  collar: ProportionDimension;
  torso: ProportionDimension;
  waist: ProportionDimension;
  l_upper_arm: ProportionDimension;
  l_lower_arm: ProportionDimension;
  l_hand: ProportionDimension;
  r_upper_arm: ProportionDimension;
  r_lower_arm: ProportionDimension;
  r_hand: ProportionDimension;
  l_upper_leg: ProportionDimension;
  l_lower_leg: ProportionDimension;
  l_foot: ProportionDimension;
  r_upper_leg: ProportionDimension;
  r_lower_leg: ProportionDimension;
  r_foot: ProportionDimension;
};

export type JointLimits = Partial<Record<PartName, { min: number; max: number }>>;
export type ParameterRange = { base: number; range: number };
export type GaitPresetTemplate = {
  name: string;
  settings: Partial<Record<keyof WalkingEngineGait, number | ParameterRange>>;
};
export type IdlePresetTemplate = {
  name: string;
  settings: Partial<Record<keyof IdleSettings, number | ParameterRange | 'left' | 'right' | 'both' | 'none'>>;
};
export type GroundingResults = {
  adjustedPose: Partial<WalkingEnginePose>;
  tensions: Record<string, number>;
  footState?: {
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
  };
};
