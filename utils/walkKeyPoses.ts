import { INITIAL_LOCOMOTION_STATE, updateLocomotionPhysics } from './locomotionEngine';
import { clamp, lerp, easeInOutQuint } from './kinematics';
import { DEFAULT_PHYSICS } from '../constants';
import {
  EasingType,
  WalkKeyPoseAnchor,
  WalkKeyPoseCycleBeat,
  WalkKeyPoseCycleSeed,
  WalkKeyPoseId,
  WalkKeyPoseSet,
  WalkingEngineGait,
  WalkingEnginePose,
} from '../types';

export const WALK_KEY_POSE_IDS: WalkKeyPoseId[] = ['contact', 'down', 'passing', 'up'];

export const DEFAULT_WALK_KEY_POSE_PHASES: Record<WalkKeyPoseId, number> = {
  contact: 0,
  down: 0.125,
  passing: 0.5,
  up: 0.75,
};

export const DEFAULT_WALK_KEY_POSE_EASING: EasingType = 'easeInOutQuint';

export const WALK_KEY_POSE_EASING_OPTIONS: EasingType[] = [
  'linear',
  'easeInQuad',
  'easeOutQuad',
  'easeInOutCubic',
  'easeInOutQuint',
];

export const WALK_CYCLE_HELPER_BEATS: WalkKeyPoseCycleBeat[] = [
  { id: 'recoil', label: 'Recoil', phase: 0.06 },
  { id: 'settle', label: 'Settle', phase: 0.18 },
  { id: 'float', label: 'Float', phase: 0.36 },
  { id: 'release', label: 'Release', phase: 0.64 },
  { id: 'anticipation', label: 'Anticipation', phase: 0.88 },
];

const POSE_BLEND_KEYS: (keyof WalkingEnginePose)[] = [
  'bodyRotation',
  'waist',
  'torso',
  'collar',
  'neck',
  'l_shoulder',
  'l_elbow',
  'l_hand',
  'r_shoulder',
  'r_elbow',
  'r_hand',
  'l_hip',
  'l_knee',
  'l_foot',
  'r_hip',
  'r_knee',
  'r_foot',
];

const normalizePhase = (phase: number): number => ((phase % 1) + 1) % 1;

const easingFns: Record<EasingType, (t: number) => number> = {
  linear: (t) => t,
  easeInQuad: (t) => t * t,
  easeOutQuad: (t) => 1 - (1 - t) * (1 - t),
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  easeInOutQuint: (t) => easeInOutQuint(t),
};

const applyEasing = (t: number, easing: EasingType): number => easingFns[easing]?.(clamp(t, 0, 1)) ?? t;

const clonePose = (pose: WalkingEnginePose): WalkingEnginePose => ({ ...pose });

const sampleCyclePose = (
  poseFactory: (phase: number) => WalkingEnginePose,
  phase: number,
  mirror = false,
): WalkingEnginePose => {
  const pose = clonePose(poseFactory(normalizePhase(phase)));
  return mirror ? mirrorWalkingPose(pose) : pose;
};

const buildCycleSeed = (sampledAtPhase: number): WalkKeyPoseCycleSeed => ({
  source: 'generated-cycle',
  sampledAtPhase: normalizePhase(sampledAtPhase),
  helperBeats: WALK_CYCLE_HELPER_BEATS.map((beat) => ({
    ...beat,
    phase: normalizePhase(beat.phase),
  })),
});

const createAnchor = (
  id: WalkKeyPoseId,
  poseFactory: (phase: number) => WalkingEnginePose,
  phase: number,
  mirror = false,
): WalkKeyPoseAnchor => {
  const cyclePose = sampleCyclePose(poseFactory, phase, mirror);
  return {
    id,
    phase: normalizePhase(phase),
    easing: DEFAULT_WALK_KEY_POSE_EASING,
    mirror,
    authored: false,
    pose: clonePose(cyclePose),
    cyclePose: clonePose(cyclePose),
  };
};

export const mirrorWalkingPose = (pose: WalkingEnginePose): WalkingEnginePose => ({
  ...pose,
  bodyRotation: -pose.bodyRotation,
  waist: -pose.waist,
  torso: -pose.torso,
  collar: -pose.collar,
  neck: -pose.neck,
  l_shoulder: -pose.r_shoulder,
  r_shoulder: -pose.l_shoulder,
  l_elbow: -pose.r_elbow,
  r_elbow: -pose.l_elbow,
  l_hand: -pose.r_hand,
  r_hand: -pose.l_hand,
  l_hip: -pose.r_hip,
  r_hip: -pose.l_hip,
  l_knee: pose.r_knee,
  r_knee: pose.l_knee,
  l_foot: -pose.r_foot,
  r_foot: -pose.l_foot,
  x_offset: -pose.x_offset,
  y_offset: pose.y_offset,
});

const buildAnchorSet = (
  poseFactory: (phase: number) => WalkingEnginePose,
  sampledAtPhase: number,
  anchorPhases: Record<WalkKeyPoseId, number> = DEFAULT_WALK_KEY_POSE_PHASES,
): WalkKeyPoseSet => ({
  selectedAnchorId: 'contact',
  cycleSeed: buildCycleSeed(sampledAtPhase),
  anchors: {
    contact: createAnchor('contact', poseFactory, anchorPhases.contact),
    down: createAnchor('down', poseFactory, anchorPhases.down),
    passing: createAnchor('passing', poseFactory, anchorPhases.passing),
    up: createAnchor('up', poseFactory, anchorPhases.up),
  },
});

export const createCycleDerivedWalkKeyPoseSet = (
  poseFactory: (phase: number) => WalkingEnginePose,
  sampledAtPhase = 0,
): WalkKeyPoseSet => buildAnchorSet(poseFactory, sampledAtPhase);

export const createNeutralWalkKeyPoseSet = (poseFactory: (phase: number) => WalkingEnginePose): WalkKeyPoseSet => createCycleDerivedWalkKeyPoseSet(poseFactory);

export const createNeutralWalkKeyPoseSetFromGait = (gait: WalkingEngineGait, physics = DEFAULT_PHYSICS, sampledAtPhase = 0): WalkKeyPoseSet => {
  const poseFactory = (phase: number): WalkingEnginePose => {
    const p = phase * Math.PI * 2;
    return updateLocomotionPhysics(p, { ...INITIAL_LOCOMOTION_STATE }, gait, physics, 1.0) as WalkingEnginePose;
  };

  return createCycleDerivedWalkKeyPoseSet(poseFactory, sampledAtPhase);
};

const reseedAnchorFromCycle = (
  anchor: WalkKeyPoseAnchor,
  poseFactory: (phase: number) => WalkingEnginePose,
): WalkKeyPoseAnchor => {
  const cyclePose = sampleCyclePose(poseFactory, anchor.phase, anchor.mirror);
  return {
    ...anchor,
    cyclePose,
    pose: anchor.authored ? clonePose(anchor.pose) : clonePose(cyclePose),
  };
};

export const resampleWalkKeyPoseSetFromCycle = (
  set: WalkKeyPoseSet,
  poseFactory: (phase: number) => WalkingEnginePose,
  sampledAtPhase: number,
): WalkKeyPoseSet => {
  const nextAnchors = { ...set.anchors };

  WALK_KEY_POSE_IDS.forEach((id) => {
    nextAnchors[id] = reseedAnchorFromCycle(nextAnchors[id], poseFactory);
  });

  return {
    ...set,
    cycleSeed: {
      ...set.cycleSeed,
      sampledAtPhase: normalizePhase(sampledAtPhase),
    },
    anchors: nextAnchors,
  };
};

export const syncNeutralWalkKeyPoseSetToGait = (
  set: WalkKeyPoseSet,
  gait: WalkingEngineGait,
  physics = DEFAULT_PHYSICS,
): WalkKeyPoseSet => {
  const poseFactory = (phase: number): WalkingEnginePose => {
    const p = phase * Math.PI * 2;
    return updateLocomotionPhysics(p, { ...INITIAL_LOCOMOTION_STATE }, gait, physics, 1.0) as WalkingEnginePose;
  };

  return resampleWalkKeyPoseSetFromCycle(set, poseFactory, set.cycleSeed.sampledAtPhase);
};

const phaseDistance = (a: number, b: number): number => {
  const delta = Math.abs(normalizePhaseReference(a) - normalizePhaseReference(b));
  return Math.min(delta, 1 - delta);
};

export const findNearestWalkKeyPoseId = (
  phase: number,
  anchors: Record<WalkKeyPoseId, WalkKeyPoseAnchor>,
): WalkKeyPoseId => {
  let nearestId: WalkKeyPoseId = WALK_KEY_POSE_IDS[0];
  let nearestDistance = Number.POSITIVE_INFINITY;

  WALK_KEY_POSE_IDS.forEach((id) => {
    const distance = phaseDistance(phase, anchors[id].phase);
    if (distance < nearestDistance) {
      nearestId = id;
      nearestDistance = distance;
    }
  });

  return nearestId;
};

const normalizePhaseReference = (phase: number): number => normalizePhase(phase);

export const captureWalkKeyPoseAnchor = (
  set: WalkKeyPoseSet,
  anchorId: WalkKeyPoseId,
  currentPose: WalkingEnginePose,
  currentPhase?: number,
  poseFactory?: (phase: number) => WalkingEnginePose,
): WalkKeyPoseSet => {
  const anchor = set.anchors[anchorId];
  const phase = normalizePhaseReference(currentPhase ?? currentPose.stride_phase ?? anchor.phase);
  const pose = anchor.mirror ? mirrorWalkingPose(currentPose) : clonePose(currentPose);
  const cyclePose = poseFactory
    ? sampleCyclePose(poseFactory, phase, anchor.mirror)
    : anchor.mirror
      ? mirrorWalkingPose(currentPose)
      : clonePose(currentPose);

  return {
    ...set,
    anchors: {
      ...set.anchors,
      [anchorId]: {
        ...anchor,
        phase,
        cyclePose,
        pose,
        authored: true,
      },
    },
  };
};

export const resetWalkKeyPoseAnchor = (
  set: WalkKeyPoseSet,
  anchorId: WalkKeyPoseId,
  poseFactory: (phase: number) => WalkingEnginePose,
): WalkKeyPoseSet => {
  const anchor = set.anchors[anchorId];
  const phase = DEFAULT_WALK_KEY_POSE_PHASES[anchorId];
  const cyclePose = sampleCyclePose(poseFactory, phase, anchor.mirror);
  const pose = clonePose(cyclePose);

  return {
    ...set,
    anchors: {
      ...set.anchors,
      [anchorId]: {
        ...anchor,
        phase,
        easing: DEFAULT_WALK_KEY_POSE_EASING,
        cyclePose,
        pose,
        authored: false,
      },
    },
  };
};

export const resetWalkKeyPoseSet = (poseFactory: (phase: number) => WalkingEnginePose): WalkKeyPoseSet => createNeutralWalkKeyPoseSet(poseFactory);

export const setWalkKeyPosePhase = (
  set: WalkKeyPoseSet,
  anchorId: WalkKeyPoseId,
  phase: number,
  poseFactory?: (phase: number) => WalkingEnginePose,
): WalkKeyPoseSet => {
  const anchor = set.anchors[anchorId];
  const normalizedPhase = normalizePhaseReference(phase);
  const cyclePose = poseFactory
    ? sampleCyclePose(poseFactory, normalizedPhase, anchor.mirror)
    : anchor.cyclePose;
  return {
    ...set,
    anchors: {
      ...set.anchors,
      [anchorId]: {
        ...anchor,
        phase: normalizedPhase,
        cyclePose,
        authored: true,
      },
    },
  };
};

export const setWalkKeyPoseEasing = (
  set: WalkKeyPoseSet,
  anchorId: WalkKeyPoseId,
  easing: EasingType,
): WalkKeyPoseSet => {
  const anchor = set.anchors[anchorId];
  return {
    ...set,
    anchors: {
      ...set.anchors,
      [anchorId]: {
        ...anchor,
        easing,
        authored: true,
      },
    },
  };
};

export const setWalkKeyPoseMirror = (
  set: WalkKeyPoseSet,
  anchorId: WalkKeyPoseId,
  mirror: boolean,
): WalkKeyPoseSet => {
  const anchor = set.anchors[anchorId];
  const nextPose = mirror === anchor.mirror ? anchor.pose : mirrorWalkingPose(anchor.pose);
  const nextCyclePose = mirror === anchor.mirror ? anchor.cyclePose : mirrorWalkingPose(anchor.cyclePose);
  return {
    ...set,
    anchors: {
      ...set.anchors,
      [anchorId]: {
        ...anchor,
        mirror,
        pose: nextPose,
        cyclePose: nextCyclePose,
        authored: true,
      },
    },
  };
};

const buildDeltaPose = (
  pose: WalkingEnginePose,
  basePose: WalkingEnginePose,
): Partial<WalkingEnginePose> => {
  const delta: Partial<WalkingEnginePose> = {};
  POSE_BLEND_KEYS.forEach((key) => {
    delta[key] = pose[key] - basePose[key];
  });
  return delta;
};

export type CompiledWalkKeyPoseAnchor = WalkKeyPoseAnchor & {
  basePose: WalkingEnginePose;
  delta: Partial<WalkingEnginePose>;
};

export type CompiledWalkKeyPoseSet = {
  selectedAnchorId: WalkKeyPoseId;
  anchors: CompiledWalkKeyPoseAnchor[];
};

export const compileWalkKeyPoseSet = (
  set: WalkKeyPoseSet,
  poseFactory: (phase: number) => WalkingEnginePose,
): CompiledWalkKeyPoseSet => {
  const anchors = WALK_KEY_POSE_IDS
    .map((id) => {
      const anchor = set.anchors[id];
      const basePose = clonePose(anchor.cyclePose ?? poseFactory(anchor.phase));
      return {
        ...anchor,
        basePose,
        delta: buildDeltaPose(anchor.pose, basePose),
      };
    })
    .sort((a, b) => a.phase - b.phase);

  return {
    selectedAnchorId: set.selectedAnchorId,
    anchors,
  };
};

const findSegment = (
  anchors: CompiledWalkKeyPoseAnchor[],
  phase: number,
): { left: CompiledWalkKeyPoseAnchor; right: CompiledWalkKeyPoseAnchor; span: number; localT: number } | null => {
  if (anchors.length === 0) return null;
  if (anchors.length === 1) {
    return { left: anchors[0], right: anchors[0], span: 1, localT: 0 };
  }

  const normalizedPhase = normalizePhaseReference(phase);
  const extended = anchors.map((anchor) => anchor).concat(
    anchors.slice(0, 1).map((anchor) => ({
      ...anchor,
      phase: anchor.phase + 1,
    })),
  );

  for (let index = 0; index < extended.length - 1; index += 1) {
    const left = extended[index];
    const right = extended[index + 1];
    if (normalizedPhase < left.phase || normalizedPhase > right.phase) continue;
    const span = right.phase - left.phase;
    const localT = span <= 0 ? 0 : (normalizedPhase - left.phase) / span;
    return { left, right, span, localT };
  }

  const left = extended[extended.length - 2];
  const right = extended[extended.length - 1];
  const span = right.phase - left.phase;
  const localT = span <= 0 ? 0 : (normalizedPhase + 1 - left.phase) / span;
  return { left, right, span, localT };
};

export const applyCompiledWalkKeyPoseOverlay = (
  basePose: WalkingEnginePose,
  phase: number,
  compiled: CompiledWalkKeyPoseSet | null,
): WalkingEnginePose => {
  if (!compiled || compiled.anchors.length === 0) {
    return { ...basePose };
  }

  const segment = findSegment(compiled.anchors, phase);
  if (!segment) {
    return { ...basePose };
  }

  const eased = applyEasing(segment.localT, segment.left.easing);
  const output = { ...basePose };

  POSE_BLEND_KEYS.forEach((key) => {
    const leftDelta = segment.left.delta[key] ?? 0;
    const rightDelta = segment.right.delta[key] ?? 0;
    output[key] = basePose[key] + lerp(leftDelta, rightDelta, eased);
  });

  output.stride_phase = normalizePhaseReference(basePose.stride_phase ?? phase);
  return output;
};
