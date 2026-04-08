import { JointMode, JointModesState, WalkingEnginePivotOffsets } from '../types';

export const JOINT_KEYS: (keyof WalkingEnginePivotOffsets)[] = [
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

export const KINEMATIC_TREE: Record<keyof WalkingEnginePivotOffsets, (keyof WalkingEnginePivotOffsets)[]> = {
  waist: ['torso', 'l_hip', 'r_hip'],
  torso: ['collar'],
  collar: ['neck', 'l_shoulder', 'r_shoulder'],
  neck: [],
  l_shoulder: ['l_elbow'],
  l_elbow: ['l_hand'],
  l_hand: [],
  r_shoulder: ['r_elbow'],
  r_elbow: ['r_hand'],
  r_hand: [],
  l_hip: ['l_knee'],
  l_knee: ['l_foot'],
  l_foot: [],
  r_hip: ['r_knee'],
  r_knee: ['r_foot'],
  r_foot: [],
};

export const POSE_JOINT_SLIDER_MIN = -360;
export const POSE_JOINT_SLIDER_MAX = 360;
export const POSE_BODY_ROTATION_MIN = -180;
export const POSE_BODY_ROTATION_MAX = 180;
export const POSE_DRAG_SENSITIVITY = 0.2;

export const formatJointLabel = (key: keyof WalkingEnginePivotOffsets): string => {
  if (key.startsWith('l_')) {
    return `L. ${key.slice(2).replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())}`;
  }
  if (key.startsWith('r_')) {
    return `R. ${key.slice(2).replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())}`;
  }
  return key.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
};

export const toggleJointMode = (
  jointModes: JointModesState,
  key: keyof WalkingEnginePivotOffsets,
  requestedMode: Exclude<JointMode, 'fk'>,
): JointModesState => {
  const currentMode = jointModes[key] ?? 'fk';
  const nextMode = currentMode === requestedMode ? 'fk' : requestedMode;
  const next = { ...jointModes };

  if (nextMode === 'fk') {
    delete next[key];
  } else {
    next[key] = nextMode;
  }

  return next;
};

export const applyJointCascade = (
  currentOffsets: WalkingEnginePivotOffsets,
  key: keyof WalkingEnginePivotOffsets,
  nextValue: number,
  jointModes: JointModesState,
): WalkingEnginePivotOffsets => {
  const delta = nextValue - currentOffsets[key];
  if (delta === 0) return currentOffsets;

  const nextOffsets = { ...currentOffsets, [key]: nextValue };

  const applyRecursiveEffect = (parentKey: keyof WalkingEnginePivotOffsets, appliedDelta: number) => {
    const parentMode = jointModes[parentKey] ?? 'fk';
    if (parentMode === 'fk') return;

    const children = KINEMATIC_TREE[parentKey];
    if (!children.length) return;

    const childDelta = parentMode === 'stretch' ? -appliedDelta : appliedDelta;
    children.forEach((childKey) => {
      nextOffsets[childKey] = (nextOffsets[childKey] ?? 0) + childDelta;
      applyRecursiveEffect(childKey, childDelta);
    });
  };

  applyRecursiveEffect(key, delta);
  return nextOffsets;
};
