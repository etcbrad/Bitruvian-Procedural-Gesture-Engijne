import { lerp, clamp } from './kinematics';
import { JOINT_KEYS } from './poserAuthoring';
import { WalkingEnginePivotOffsets, WalkingEnginePose } from '../types';

export type PhaseKeyframe = {
  phase: number;
  offsets: Partial<WalkingEnginePivotOffsets>;
};

export type PhaseTimelineMarkerKind = 'contact' | 'extreme';

export type PhaseTimelineMarker = {
  phase: number;
  label: string;
  kind: PhaseTimelineMarkerKind;
  description: string;
};

export type PhaseBlendContext = {
  pose?: WalkingEnginePose | null;
};

const PHASE_PRECISION = 4;
const PHASE_TOLERANCE = 1 / (10 ** PHASE_PRECISION);

export const PHASE_TIMELINE_MARKERS: PhaseTimelineMarker[] = [
  { phase: 0.0, label: 'Contact', kind: 'contact', description: 'Initial contact / landing' },
  { phase: 0.125, label: 'Lift', kind: 'extreme', description: 'Early lift / rise' },
  { phase: 0.25, label: 'Passing', kind: 'contact', description: 'Passing / mid support' },
  { phase: 0.375, label: 'Peak', kind: 'extreme', description: 'Visible extreme / apex' },
  { phase: 0.5, label: 'Contact', kind: 'contact', description: 'Opposite contact / landing' },
  { phase: 0.625, label: 'Lift', kind: 'extreme', description: 'Opposite lift / rise' },
  { phase: 0.75, label: 'Passing', kind: 'contact', description: 'Opposite passing / mid support' },
  { phase: 0.875, label: 'Peak', kind: 'extreme', description: 'Opposite extreme / apex' },
];

const roundPhase = (phase: number): number => {
  const rounded = Number(phase.toFixed(PHASE_PRECISION));
  return rounded >= 1 ? 0 : rounded;
};

export const normalizePhase = (phase: number): number => roundPhase(((phase % 1) + 1) % 1);

export const circularPhaseDistance = (a: number, b: number): number => {
  const delta = Math.abs(normalizePhase(a) - normalizePhase(b));
  return Math.min(delta, 1 - delta);
};

const calculateLegLiftAwareness = (knee: number, foot: number): number => {
  // Higher knee values usually mean the limb is lifted and ready to impact, so
  // we bias damping more strongly there and let the foot only add a small cue.
  const kneeLift = clamp((Math.abs(knee) - 6) / 32, 0, 1);
  const footCue = clamp(Math.abs(foot + 90) / 30, 0, 1);
  return clamp((kneeLift * 0.9) + (footCue * 0.1), 0, 1);
};

const calculatePhaseAwareness = (pose?: WalkingEnginePose | null): number => {
  if (!pose) return 0;

  const leftLift = calculateLegLiftAwareness(pose.l_knee, pose.l_foot);
  const rightLift = calculateLegLiftAwareness(pose.r_knee, pose.r_foot);
  return clamp(Math.max(leftLift, rightLift), 0, 1);
};

export const compressPivotOffsets = (offsets: Partial<WalkingEnginePivotOffsets>): Partial<WalkingEnginePivotOffsets> => {
  const next: Partial<WalkingEnginePivotOffsets> = {};

  JOINT_KEYS.forEach((key) => {
    const value = offsets[key];
    if (Math.abs(value ?? 0) > 0.0001) {
      next[key] = value;
    }
  });

  return next;
};

export const fillPivotOffsets = (offsets: Partial<WalkingEnginePivotOffsets> = {}): WalkingEnginePivotOffsets => {
  const next = {} as WalkingEnginePivotOffsets;

  JOINT_KEYS.forEach((key) => {
    next[key] = offsets[key] ?? 0;
  });

  return next;
};

export const normalizePhaseKeyframe = (keyframe: PhaseKeyframe): PhaseKeyframe => ({
  phase: normalizePhase(keyframe.phase),
  offsets: compressPivotOffsets(keyframe.offsets),
});

export const normalizePhaseKeyframes = (keyframes: PhaseKeyframe[]): PhaseKeyframe[] => {
  const deduped = new Map<number, PhaseKeyframe>();

  keyframes.forEach((keyframe) => {
    const next = normalizePhaseKeyframe(keyframe);
    deduped.set(next.phase, next);
  });

  return Array.from(deduped.values()).sort((a, b) => a.phase - b.phase);
};

export const findPhaseKeyframeAtPhase = (keyframes: PhaseKeyframe[], phase: number): PhaseKeyframe | null => {
  const normalizedPhase = normalizePhase(phase);
  return normalizePhaseKeyframes(keyframes).find((keyframe) => Math.abs(keyframe.phase - normalizedPhase) <= PHASE_TOLERANCE) ?? null;
};

export const upsertPhaseKeyframe = (keyframes: PhaseKeyframe[], nextKeyframe: PhaseKeyframe): PhaseKeyframe[] => {
  const normalized = normalizePhaseKeyframe(nextKeyframe);
  const existingIndex = normalizePhaseKeyframes(keyframes).findIndex((keyframe) => Math.abs(keyframe.phase - normalized.phase) <= PHASE_TOLERANCE);
  const next = normalizePhaseKeyframes(keyframes);

  if (existingIndex >= 0) {
    next.splice(existingIndex, 1, normalized);
  } else {
    next.push(normalized);
  }

  return next.sort((a, b) => a.phase - b.phase);
};

export const makePhaseKeyframe = (phase: number, offsets: Partial<WalkingEnginePivotOffsets>): PhaseKeyframe => ({
  phase: normalizePhase(phase),
  offsets: compressPivotOffsets(offsets),
});

const smootherstep = (t: number): number => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
};

const easePhaseProgress = (t: number, awareness: number): number => {
  const smoothed = smootherstep(t);
  const damping = lerp(1.0, 2.2, clamp(awareness, 0, 1));
  return Math.max(0, Math.min(1, Math.pow(smoothed, damping)));
};

const catmullRom = (p0: number, p1: number, p2: number, p3: number, t: number): number => {
  const tt = t * t;
  const ttt = tt * t;
  return 0.5 * (
    (2 * p1)
    + ((-p0 + p2) * t)
    + ((2 * p0 - (5 * p1) + (4 * p2) - p3) * tt)
    + ((-p0 + (3 * p1) - (3 * p2) + p3) * ttt)
  );
};

const getWrappedIndex = (index: number, length: number): number => ((index % length) + length) % length;

const sampleJointOffset = (keyframes: PhaseKeyframe[], lowIndex: number, highIndex: number, t: number, key: keyof WalkingEnginePivotOffsets): number => {
  const lowValue = keyframes[lowIndex].offsets[key] ?? 0;
  const highValue = keyframes[highIndex].offsets[key] ?? 0;

  if (keyframes.length < 3) {
    return lerp(lowValue, highValue, t);
  }

  const prevValue = keyframes[getWrappedIndex(lowIndex - 1, keyframes.length)].offsets[key] ?? 0;
  const nextValue = keyframes[getWrappedIndex(highIndex + 1, keyframes.length)].offsets[key] ?? 0;
  return catmullRom(prevValue, lowValue, highValue, nextValue, t);
};

export const blendPhaseKeyframeOffsets = (
  keyframes: PhaseKeyframe[],
  phase: number,
  context?: PhaseBlendContext,
): Partial<WalkingEnginePivotOffsets> => {
  const normalizedPhase = normalizePhase(phase);
  const sorted = normalizePhaseKeyframes(keyframes);

  if (sorted.length === 0) {
    return {};
  }

  if (sorted.length === 1) {
    return sorted[0].offsets;
  }

  const exactMatch = sorted.find((keyframe) => Math.abs(keyframe.phase - normalizedPhase) <= PHASE_TOLERANCE);
  if (exactMatch) {
    return exactMatch.offsets;
  }

  const highIndex = sorted.findIndex((keyframe) => keyframe.phase > normalizedPhase);
  const high = highIndex >= 0 ? sorted[highIndex] : sorted[0];
  const lowIndex = highIndex > 0 ? highIndex - 1 : sorted.length - 1;
  const low = sorted[lowIndex];
  const wrappedHighPhase = high.phase <= low.phase ? high.phase + 1 : high.phase;
  const span = wrappedHighPhase - low.phase;

  if (span <= 0.0001) {
    return high.offsets;
  }

  const phaseForInterpolation = normalizedPhase < low.phase ? normalizedPhase + 1 : normalizedPhase;
  const awareness = calculatePhaseAwareness(context?.pose);
  const t = easePhaseProgress((phaseForInterpolation - low.phase) / span, awareness);
  const blended: Partial<WalkingEnginePivotOffsets> = {};

  JOINT_KEYS.forEach((key) => {
    const nextValue = sampleJointOffset(sorted, lowIndex, highIndex >= 0 ? highIndex : 0, t, key);

    if (Math.abs(nextValue) > 0.0001) {
      blended[key] = nextValue;
    }
  });

  return blended;
};
