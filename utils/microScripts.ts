
import { WalkingEnginePose, MicroScriptInstance } from '../types';

export type MicroScriptDefinition = {
  id: string;
  duration: number;
  update: (progress: number) => Partial<WalkingEnginePose>;
};

export const MICRO_SCRIPTS: Record<string, MicroScriptDefinition> = {
  nod: {
    id: 'nod',
    duration: 1200,
    update: (p) => ({
      neck: Math.sin(p * Math.PI * 4) * 8,
      torso: Math.sin(p * Math.PI * 2) * 2
    })
  },
  scratch_neck: {
    id: 'scratch_neck',
    duration: 2000,
    update: (p) => {
      const active = p > 0.2 && p < 0.8;
      const intensity = active ? Math.sin(p * 40) * 10 : 0;
      return {
        l_shoulder: -80,
        l_elbow: -140,
        l_hand: intensity,
        neck: 10 + intensity * 0.2
      };
    }
  },
  look_around: {
    id: 'look_around',
    duration: 3000,
    update: (p) => ({
      neck: Math.sin(p * Math.PI * 2) * 45,
      collar: Math.sin(p * Math.PI * 2) * 5
    })
  },
  chest_puff: {
    id: 'chest_puff',
    duration: 2500,
    update: (p) => {
      const swell = Math.sin(p * Math.PI);
      return {
        torso: swell * -10,
        collar: swell * -5,
        l_shoulder: swell * 15,
        r_shoulder: swell * -15
      };
    }
  },
  shiver: {
    id: 'shiver',
    duration: 1500,
    update: (p) => {
      const jitter = Math.sin(p * 100) * 2;
      return {
        torso: jitter,
        collar: jitter,
        neck: jitter,
        l_shoulder: jitter * 2,
        r_shoulder: -jitter * 2
      };
    }
  }
};

export const getScriptsForTrait = (trait: string): string[] => {
  switch (trait) {
    case 'nervous':
    case 'anxious':
    case 'scared':
      return ['shiver', 'look_around', 'scratch_neck'];
    case 'confident':
    case 'proud':
    case 'bold':
    case 'heroic':
      return ['chest_puff', 'nod'];
    case 'lazy':
    case 'sluggish':
      return ['look_around'];
    case 'playful':
      return ['nod', 'look_around'];
    default:
      return [];
  }
};

export const processActiveScripts = (
  time: number,
  activeScripts: MicroScriptInstance[]
): { pose: Partial<WalkingEnginePose>; remaining: MicroScriptInstance[] } => {
  const resultPose: Partial<WalkingEnginePose> = {};
  const remaining: MicroScriptInstance[] = [];

  activeScripts.forEach((instance) => {
    const elapsed = time - instance.startTime;
    const progress = Math.min(1, elapsed / instance.duration);
    const script = MICRO_SCRIPTS[instance.scriptId];

    if (script && progress < 1) {
      const scriptPose = script.update(progress);
      Object.keys(scriptPose).forEach((key) => {
        const k = key as keyof WalkingEnginePose;
        (resultPose as any)[k] = ((resultPose as any)[k] || 0) + (scriptPose[k] as number) * instance.weight;
      });
      remaining.push(instance);
    }
  });

  return { pose: resultPose, remaining };
};
