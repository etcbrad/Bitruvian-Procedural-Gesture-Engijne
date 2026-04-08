import { DEFAULT_RESTING_POSE } from '../constants';
import { WalkingEnginePose } from '../types';

export const POSE_SERIALIZATION_ORDER: (keyof WalkingEnginePose)[] = [
  'bodyRotation',
  'waist',
  'neck',
  'collar',
  'torso',
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
  'stride_phase',
  'y_offset',
  'x_offset',
];

export const POSE_SHORT_KEY_MAP: Record<keyof WalkingEnginePose, string> = {
  bodyRotation: 'br',
  waist: 'w',
  neck: 'n',
  collar: 'c',
  torso: 't',
  l_shoulder: 'ls',
  l_elbow: 'le',
  l_hand: 'lh',
  r_shoulder: 'rs',
  r_elbow: 're',
  r_hand: 'rh',
  l_hip: 'li',
  l_knee: 'lk',
  l_foot: 'lf',
  r_hip: 'ri',
  r_knee: 'rk',
  r_foot: 'rf',
  stride_phase: 'sp',
  y_offset: 'yo',
  x_offset: 'xo',
};

const POSE_LONG_KEY_MAP = Object.fromEntries(
  Object.entries(POSE_SHORT_KEY_MAP).map(([longKey, shortKey]) => [shortKey, longKey]),
) as Record<string, keyof WalkingEnginePose>;

const round = (value: number): number => parseFloat(value.toFixed(2));

export const poseToString = (pose: Partial<WalkingEnginePose>): string => {
  const parts: string[] = [];

  POSE_SERIALIZATION_ORDER.forEach((key) => {
    const value = pose[key];
    if (typeof value !== 'number' || Number.isNaN(value)) return;
    parts.push(`${POSE_SHORT_KEY_MAP[key]}:${round(value)}`);
  });

  return parts.join(';');
};

export const stringToPose = (value: string): WalkingEnginePose => {
  const pose: WalkingEnginePose = { ...DEFAULT_RESTING_POSE };

  if (!value || typeof value !== 'string') {
    return pose;
  }

  value.split(';').forEach((pair) => {
    const [shortKey, rawNumber] = pair.split(':');
    if (!shortKey || rawNumber === undefined) return;

    const longKey = POSE_LONG_KEY_MAP[shortKey];
    if (!longKey) return;

    const parsed = Number(rawNumber);
    if (Number.isNaN(parsed)) return;

    (pose as any)[longKey] = parsed;
  });

  return pose;
};
