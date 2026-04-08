import { INITIAL_LOCOMOTION_STATE, updateLocomotionPhysics } from './locomotionEngine';
import { clamp, lerp, easeInOutQuint } from './kinematics';
import { DEFAULT_PHYSICS } from '../constants';
import { EasingType, WalkKeyPoseAnchor, WalkKeyPoseId, WalkKeyPoseSet, WalkingEngineGait, WalkingEnginePose } from '../types';

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

const createNeutralAnchor = (id: WalkKeyPoseId, poseFactory: (phase: number) => WalkingEnginePose): WalkKeyPoseAnchor => ({
  id,
  phase: DEFAULT_WALK_KEY_POSE_PHASES[id],
  easing: DEFAULT_WALK_KEY_POSE_EASING,
  mirror: false,
  authored: false,
  pose: { ...poseFactory(DEFAULT_WALK_KEY_POSE_PHASES[id]) },
});

const createAnchor = (anchor: WalkKeyPoseAnchor): WalkKeyPoseAnchor => ({
  ...anchor,
  pose: { ...anchor.pose },
});

const clonePose = (pose: WalkingEnginePose): WalkingEnginePose => ({ ...pose });

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

const buildAnchorSet = (anchorMap: Record<WalkKeyPoseId, WalkKeyPoseAnchor>): WalkKeyPoseSet => ({
  selectedAnchorId: 'contact',
  anchors: {
    contact: createAnchor(anchorMap.contact),
    down: createAnchor(anchorMap.down),
    passing: createAnchor(anchorMap.passing),
    up: createAnchor(anchorMap.up),
  },
});

export const createNeutralWalkKeyPoseSet = (poseFactory: (phase: number) => WalkingEnginePose): WalkKeyPoseSet => buildAnchorSet({
  contact: createNeutralAnchor('contact', poseFactory),
  down: createNeutralAnchor('down', poseFactory),
  passing: createNeutralAnchor('passing', poseFactory),
  up: createNeutralAnchor('up', poseFactory),
});

export const createNeutralWalkKeyPoseSetFromGait = (gait: WalkingEngineGait, physics = DEFAULT_PHYSICS): WalkKeyPoseSet => {
  const poseFactory = (phase: number): WalkingEnginePose => {
    const p = phase * Math.PI * 2;
    return updateLocomotionPhysics(p, { ...INITIAL_LOCOMOTION_STATE }, gait, physics, 1.0) as WalkingEnginePose;
  };

  return createNeutralWalkKeyPoseSet(poseFactory);
};

export const syncNeutralWalkKeyPoseSetToGait = (
  set: WalkKeyPoseSet,
  gait: WalkingEngineGait,
  physics = DEFAULT_PHYSICS,
): WalkKeyPoseSet => {
  let changed = false;
  const nextAnchors = { ...set.anchors };

  WALK_KEY_POSE_IDS.forEach((id) => {
    const anchor = nextAnchors[id];
    if (anchor.authored) return;
    const p = anchor.phase * Math.PI * 2;
    nextAnchors[id] = {
      ...anchor,
      pose: updateLocomotionPhysics(p, { ...INITIAL_LOCOMOTION_STATE }, gait, physics, 1.0) as WalkingEnginePose,
    };
    changed = true;
  });

  if (!changed) return set;
  return {
    ...set,
    anchors: nextAnchors,
  };
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
): WalkKeyPoseSet => {
  const anchor = set.anchors[anchorId];
  const phase = normalizePhaseReference(currentPhase ?? currentPose.stride_phase ?? anchor.phase);
  const pose = anchor.mirror ? mirrorWalkingPose(currentPose) : clonePose(currentPose);

  return {
    ...set,
    anchors: {
      ...set.anchors,
      [anchorId]: {
        ...anchor,
        phase,
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
  const pose = anchor.mirror ? mirrorWalkingPose(poseFactory(phase)) : clonePose(poseFactory(phase));

  return {
    ...set,
    anchors: {
      ...set.anchors,
      [anchorId]: {
        ...anchor,
        phase,
        easing: DEFAULT_WALK_KEY_POSE_EASING,
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
): WalkKeyPoseSet => {
  const anchor = set.anchors[anchorId];
  return {
    ...set,
    anchors: {
      ...set.anchors,
      [anchorId]: {
        ...anchor,
        phase: normalizePhaseReference(phase),
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
  return {
    ...set,
    anchors: {
      ...set.anchors,
      [anchorId]: {
        ...anchor,
        mirror,
        pose: nextPose,
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
      const basePose = poseFactory(anchor.phase);
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
