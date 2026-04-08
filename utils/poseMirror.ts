import { PoseLibraryEntry, WalkingEnginePose } from '../types';
import { poseToString } from './poseParser';

export const mirrorWalkingPose = (pose: WalkingEnginePose): WalkingEnginePose => ({
  ...pose,
  bodyRotation: -pose.bodyRotation,
  waist: -pose.waist,
  neck: -pose.neck,
  collar: -pose.collar,
  torso: -pose.torso,
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

export const mirrorPoseEntry = (entry: PoseLibraryEntry): PoseLibraryEntry => {
  const pose = mirrorWalkingPose(entry.pose);

  return {
    ...entry,
    id: `${entry.id}_R`,
    name: `RIGHT ${entry.name}`,
    src: 'Bitruvian Generated',
    mirrored: true,
    sourceId: entry.id,
    pose,
    data: poseToString(pose),
  };
};
