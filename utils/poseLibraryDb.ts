import { DEFAULT_RESTING_POSE } from '../constants';
import { PoseLibraryCategory, PoseLibraryEntry, WalkingEnginePose } from '../types';
import { mirrorPoseEntry } from './poseMirror';
import { poseToString } from './poseParser';

const createPose = (overrides: Partial<WalkingEnginePose>): WalkingEnginePose => ({
  ...DEFAULT_RESTING_POSE,
  ...overrides,
});

const createEntry = (
  id: string,
  cat: PoseLibraryCategory,
  name: string,
  src: string,
  phaseHint: number,
  poseOverrides: Partial<WalkingEnginePose>,
): PoseLibraryEntry => {
  const pose = createPose({
    ...poseOverrides,
    stride_phase: phaseHint,
  });

  return {
    id,
    cat,
    name,
    src,
    phaseHint,
    pose,
    data: poseToString(pose),
  };
};

const baseEntries = [
  createEntry('B01', 'Base', 'T-Pose', 'Bitruvius', 0, {
    bodyRotation: 0,
    waist: 0,
    neck: 0,
    collar: 0,
    torso: 0,
    l_shoulder: -90,
    r_shoulder: 90,
    l_elbow: 0,
    r_elbow: 0,
    l_hand: 0,
    r_hand: 0,
    l_hip: 0,
    r_hip: 0,
    l_knee: 0,
    r_knee: 0,
    l_foot: 0,
    r_foot: 0,
    x_offset: 0,
    y_offset: 0,
  }),
  createEntry('A06', 'Action', 'Shield', 'Manual', 0.125, {
    bodyRotation: 0,
    waist: 0,
    torso: 0,
    collar: 0,
    neck: 187.81,
    r_shoulder: 178.87,
    r_elbow: 176.45,
    r_hand: 62.24,
    l_shoulder: -178.18,
    l_elbow: 177.87,
    l_hand: 0,
    r_hip: -169.88,
    r_knee: 180.62,
    r_foot: 90,
    l_hip: -189.97,
    l_knee: 179.19,
    l_foot: 90,
  }),
  createEntry('D02', 'Dance', 'Ballerina', 'Manual', 0.5, {
    bodyRotation: 0,
    waist: 0,
    torso: 5,
    collar: 0,
    neck: -10,
    l_shoulder: 60,
    l_elbow: -45,
    l_hand: 20,
    r_shoulder: -135,
    r_elbow: 30,
    r_hand: -20,
    l_hip: -10,
    l_knee: 100,
    l_foot: 90,
    r_hip: 30,
    r_knee: 0,
    r_foot: 90,
  }),
  createEntry('A08', 'Action', 'Fly', 'User', 0.75, {
    bodyRotation: 0,
    waist: 0,
    torso: 180.51,
    collar: 0,
    neck: 0,
    r_shoulder: -252.19,
    r_elbow: 0,
    r_hand: 0,
    l_shoulder: -108.15,
    l_elbow: 0,
    l_hand: 0,
    r_hip: 0,
    r_knee: -179.21,
    r_foot: 90,
    l_hip: 0,
    l_knee: -179.23,
    l_foot: 90,
  }),
  createEntry('S01', 'Still', 'Tree Ornament', 'User', 0.88, {
    bodyRotation: 0,
    waist: 0,
    torso: 180.51,
    collar: 0,
    neck: -184.08,
    r_shoulder: -252.19,
    r_elbow: 71.74,
    r_hand: 0,
    l_shoulder: -108.15,
    l_elbow: 285.89,
    l_hand: 0,
    r_hip: 0,
    r_knee: -179.21,
    r_foot: 90,
    l_hip: 0,
    l_knee: -179.23,
    l_foot: 90,
  }),
  createEntry('C01', 'Character', 'Mustachioed', 'User', 0.18, {
    bodyRotation: 0,
    waist: 0,
    torso: 180.56,
    collar: 0,
    neck: 0,
    r_shoulder: 0,
    r_elbow: 0,
    r_hand: 0,
    l_shoulder: 0,
    l_elbow: 0,
    l_hand: 0,
    r_hip: -80.31,
    r_knee: 131.28,
    r_foot: 90,
    l_hip: -275.29,
    l_knee: -132.04,
    l_foot: 90,
  }),
  createEntry('C02', 'Character', 'Lobster', 'User', 0.62, {
    bodyRotation: 0,
    waist: 0,
    torso: 180.39,
    collar: 0,
    neck: -190.78,
    r_shoulder: 291.03,
    r_elbow: 179.18,
    r_hand: 0,
    l_shoulder: 65.93,
    l_elbow: 186.1,
    l_hand: 0,
    r_hip: 0,
    r_knee: 0,
    r_foot: 90,
    l_hip: 0,
    l_knee: 0,
    l_foot: 90,
  }),
];

const mirroredEntries = [
  mirrorPoseEntry(baseEntries[1]),
  mirrorPoseEntry(baseEntries[2]),
  mirrorPoseEntry(baseEntries[4]),
];

export const POSE_LIBRARY_DB: PoseLibraryEntry[] = [
  ...baseEntries,
  ...mirroredEntries,
];

export const POSE_LIBRARY_BY_ID = Object.fromEntries(
  POSE_LIBRARY_DB.map((entry) => [entry.id, entry]),
) as Record<string, PoseLibraryEntry>;

export const POSE_LIBRARY_CATEGORIES: PoseLibraryCategory[] = ['Base', 'Action', 'Dance', 'Still', 'Character'];
