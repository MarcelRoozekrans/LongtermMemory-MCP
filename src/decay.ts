export const DECAY_CONFIG = {
  halfLifeDays: {
    general: 60,
    conversation: 45,
    fact: 120,
    preference: 90,
    task: 30,
    ephemeral: 10,
  } as Record<string, number>,
  floors: {
    general: 1,
    conversation: 2,
    fact: 3,
    preference: 2,
    task: 1,
    ephemeral: 1,
  } as Record<string, number>,
  protectedTags: new Set(["core", "identity", "pinned"]),
  writebackStep: 0.5,
  reinforcementStep: 0.1,
  reinforcementWritebackStep: 0.5,
  maxImportance: 10,
};

export class DecayEngine {
  private roundToHalf(value: number): number {
    return Math.round(value * 2) / 2;
  }

  computeDecay(importance: number, daysIdle: number, memoryType: string): number {
    const halfLife = DECAY_CONFIG.halfLifeDays[memoryType] ?? DECAY_CONFIG.halfLifeDays.general;
    const floor = DECAY_CONFIG.floors[memoryType] ?? DECAY_CONFIG.floors.general;

    if (daysIdle <= 0 || halfLife <= 0) return importance;

    const factor = Math.pow(0.5, daysIdle / halfLife);
    const decayed = this.roundToHalf(importance * factor);
    return Math.max(floor, decayed);
  }

  shouldProtect(tags: string[]): boolean {
    return tags.some((tag) => DECAY_CONFIG.protectedTags.has(tag));
  }

  shouldWriteDecay(oldImportance: number, newImportance: number): boolean {
    return oldImportance - newImportance >= DECAY_CONFIG.writebackStep;
  }

  computeReinforcement(
    importance: number,
    currentAccum: number,
  ): { newAccum: number; shouldWrite: boolean; newImportance?: number } {
    const accum = currentAccum + DECAY_CONFIG.reinforcementStep;

    if (accum >= DECAY_CONFIG.reinforcementWritebackStep) {
      const newImportance = Math.min(
        DECAY_CONFIG.maxImportance,
        this.roundToHalf(importance + accum),
      );
      return { newAccum: 0, shouldWrite: true, newImportance };
    }

    return { newAccum: accum, shouldWrite: false };
  }
}
