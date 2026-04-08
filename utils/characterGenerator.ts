
import { CharacterMorphology, TextualCharacterDescription, GaitGenome } from '../types';

export class CharacterGenerator {
  private static stringToSeed(str: string, salt: number = 0): number {
    let hash = 0;
    const combined = str + salt.toString();
    for (let i = 0; i < combined.length; i++) {
      hash = (hash << 5) - hash + combined.charCodeAt(i);
      hash |= 0; 
    }
    return Math.abs(hash);
  }

  private static getSeededRandom(seed: number): () => number {
    return () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
  }

  static parseDescription(text: string): TextualCharacterDescription {
    const description: TextualCharacterDescription = {
      text,
      extracted: {
        size: 'medium', weight: 'normal', limbType: 'legs',
        behavior: [], mood: [], specialAbilities: [], symmetry: 'bilateral',
      },
    };
    const lower = text.toLowerCase();
    
    if (/tiny|small|mini|micro|minuscule|little/.test(lower)) description.extracted.size = 'tiny';
    else if (/large|big|giant|huge|enormous|massive|tall/.test(lower)) description.extracted.size = lower.includes('massive') ? 'massive' : 'large';

    if (/light|nimble|agile|graceful|delicate|thin/.test(lower)) description.extracted.weight = 'light';
    else if (/heavy|bulky|ponderous|thick|sturdy|strong/.test(lower)) description.extracted.weight = 'heavy';
    else if (/massive|colossal|leviathan|tank/.test(lower)) description.extracted.weight = 'massive';

    const behaviors = ['creeping', 'prowling', 'stalking', 'sneaking', 'sprinting', 'dashing', 'waddling', 'bounding', 'skittering', 'graceful', 'elegant', 'jerky', 'bouncy', 'energetic', 'sluggish', 'robotic', 'fluid', 'stiff'];
    behaviors.forEach(b => { if (lower.includes(b)) description.extracted.behavior.push(b); });

    const moods = ['confident', 'proud', 'arrogant', 'nervous', 'anxious', 'timid', 'relaxed', 'calm', 'aggressive', 'playful', 'lazy', 'vigilant', 'heroic', 'clumsy', 'bold', 'scared'];
    moods.forEach(m => { if (lower.includes(m)) description.extracted.mood.push(m); });

    return description;
  }

  static generateCharacter(text: string, entropy: number = Date.now()): CharacterMorphology {
    const parsed = this.parseDescription(text);
    const seed = this.stringToSeed(text, entropy);
    const rng = this.getSeededRandom(seed);
    
    const id = `char_${Date.now()}_${rng().toString(36).slice(2, 9)}`;
    const sizeMap = { tiny: 0.3, small: 0.6, medium: 1.0, large: 1.5, massive: 2.0 };
    const weightMap = { light: 0.3, normal: 0.5, heavy: 0.8, massive: 1.0 };
    
    const sizeData = sizeMap[parsed.extracted.size];
    const weightVal = weightMap[parsed.extracted.weight];

    let stride = 1, frequency = 1, bodyBounce = 0.5, confidence = 0.5, anxiousness = 0, agility = 0.5;

    // Apply seed variance to base parameters
    stride += (rng() - 0.5) * 0.4;
    frequency += (rng() - 0.5) * 0.4;
    confidence += (rng() - 0.5) * 0.5;
    agility += (rng() - 0.5) * 0.4;

    parsed.extracted.behavior.forEach(b => {
      if (['creeping', 'sneaking', 'stalking'].includes(b)) { stride *= 0.6; frequency *= 0.5; confidence *= 0.3; anxiousness += 0.4; }
      if (['sprinting', 'dashing'].includes(b)) { stride *= 1.4; frequency *= 1.5; agility += 0.5; confidence += 0.4; }
      if (['bounding', 'hopping', 'bouncy'].includes(b)) { stride *= 1.2; frequency *= 1.1; bodyBounce += 0.4; }
      if (['robotic', 'stiff'].includes(b)) { bodyBounce *= 0.1; agility *= 0.5; frequency *= 0.8; }
      if (['fluid', 'graceful'].includes(b)) { agility += 0.4; bodyBounce *= 1.2; }
    });

    parsed.extracted.mood.forEach(m => {
      if (['confident', 'proud', 'heroic', 'bold'].includes(m)) { confidence = Math.min(1.5, confidence + 0.6); anxiousness = 0; }
      if (['anxious', 'timid', 'nervous', 'scared'].includes(m)) { anxiousness = Math.min(1.5, anxiousness + 0.6); confidence = Math.max(0, confidence - 0.5); stride *= 0.6; }
      if (['clumsy'].includes(m)) { agility *= 0.4; bodyBounce += 0.5; stride *= 1.2; }
      if (['lazy', 'relaxed'].includes(m)) { frequency *= 0.6; confidence = 0.4; }
    });

    const genome: GaitGenome = {
      stride: { base: stride, speed: 0.1, variance: rng() * 0.2, responsiveness: 0.8 },
      frequency: { base: frequency, speed: 0.15, variance: rng() * 0.2, responsiveness: 0.9 },
      amplitude: { base: 0.6, speed: 0.1, variance: 0.05, responsiveness: 0.7 },
      phaseLags: [0, Math.PI],
      footFall: 'diagonal',
      bodyRoll: { base: 0.3 * (1 - weightVal), speed: 0.1, variance: rng() * 0.1, responsiveness: 0.7 },
      bodyPitch: { base: 0.2, speed: 0.12, variance: 0.05, responsiveness: 0.8 },
      bodyBounce: { base: bodyBounce, speed: 0.2, variance: rng() * 0.3, responsiveness: 0.9 },
      ankleFlexion: { base: 0.6, speed: 0.15, variance: 0.1, responsiveness: 0.85 },
      kneeFlexion: { base: 0.5, speed: 0.12, variance: 0.06, responsiveness: 0.8 },
      hipSwing: { base: 0.4 * stride, speed: 0.1, variance: 0.05, responsiveness: 0.75 },
      shoulderSwing: { base: 0.3 * (1 - weightVal * 0.5), speed: 0.1, variance: 0.05, responsiveness: 0.7 },
      energyCost: weightVal, stability: 1 - weightVal * 0.4, agility, weight: weightVal,
      idleMovement: 0.3 + anxiousness * 0.2, anxiousness, confidence,
    };

    return {
      id, name: this.generateName(parsed.extracted),
      type: 'biped', anatomy: { limbCount: 2, limbPairs: [], centerOfMass: 0.5, bodyLength: sizeData, limbLength: sizeData * 0.6, symmetry: 'bilateral' },
      gaitDNA: genome, constraints: { maxSpeed: 200, minSpeed: 20, maxTurnRate: 1, legStepHeight: 30, footClearance: 10, strikeType: 'midfoot' },
      description: text, tags: [...parsed.extracted.behavior, ...parsed.extracted.mood], generatedFrom: text,
    };
  }

  private static generateName(e: any): string {
    const s = { tiny: 'Tiny', small: 'Small', medium: '', large: 'Large', massive: 'Massive' };
    const w = { light: 'Swift', normal: '', heavy: 'Ponderous', massive: 'Colossal' };
    const prefix = s[e.size as keyof typeof s] || '';
    const weightPrefix = w[e.weight as keyof typeof w] || '';
    return `${prefix} ${weightPrefix} Walker`.trim() || "Bitruvius Subject";
  }
}
