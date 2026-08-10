import { dangerClockBaseRate, corruptionDangerRate } from '../rules/scaling.js';

export function createRunState(worldSeed, party) {
  return {
    worldSeed,
    creationTimestamp: Date.now(),
    depth: 1,
    floorSubSeed: 0,
    party,
    partyPosition: { x: 10, y: 0 },
    fogOfWar: new Uint8Array(80),
    openedContainers: 0n,
    defeatedEnemies: 0n,
    dangerClockProgress: 0,
    inventory: [],
    corruption: 0,
    credits: 0,
    scrapCounter: 0,
    themesSeen: new Set(),
    echoQueue: [],
    rngState: null,
    flags: { version: 1, calibrationFloorsReached: [] },
    serialize() {
      return {
        worldSeed: this.worldSeed,
        creationTimestamp: this.creationTimestamp,
        depth: this.depth,
        floorSubSeed: this.floorSubSeed,
        partyPosition: { ...this.partyPosition },
        fogOfWar: Array.from(this.fogOfWar),
        openedContainers: this.openedContainers.toString(),
        defeatedEnemies: this.defeatedEnemies.toString(),
        dangerClockProgress: this.dangerClockProgress,
        party: this.party,
        inventory: this.inventory,
        corruption: this.corruption,
        credits: this.credits,
        scrapCounter: this.scrapCounter,
        themesSeen: Array.from(this.themesSeen),
        echoQueue: this.echoQueue,
        rngState: this.rngState,
        flags: { ...this.flags, calibrationFloorsReached: [...this.flags.calibrationFloorsReached] }
      };
    },
    advanceFloor() {
      this.depth++;
      this.fogOfWar = new Uint8Array(80);
      this.openedContainers = 0n;
      this.defeatedEnemies = 0n;
      for (const c of this.party) {
        if (c.conditions) c.conditions = [];
      }
    },
    addCorruption(amount) {
      this.corruption += amount;
    },
    queueEcho(deadCharacter, deathFloor) {
      if (this.echoQueue.length >= 2) return;
      const appearanceFloor = deathFloor + 2 + Math.floor(Math.random() * 3);
      this.echoQueue.push({
        character: deadCharacter,
        deathFloor,
        appearanceFloor
      });
    },
    getDangerClockRate() {
      const base = dangerClockBaseRate(this.depth);
      const corruptionMod = corruptionDangerRate(this.corruption);
      return base + corruptionMod;
    },
    markContainerOpened(containerId) {
      this.openedContainers |= (1n << BigInt(containerId));
    },
    markEnemyDefeated(enemyId) {
      this.defeatedEnemies |= (1n << BigInt(enemyId));
    },
    markCellVisited(x, y) {
      const idx = y * 20 + x;
      const byte = Math.floor(idx / 8);
      const bit = idx % 8;
      if (byte >= 0 && byte < this.fogOfWar.length) {
        this.fogOfWar[byte] |= (1 << bit);
      }
    },
    addScrap(val) {
      this.scrapCounter += val;
    },
    getInventoryCount() {
      return this.inventory.length;
    },
    isInventoryFull() {
      return this.inventory.length >= 100;
    }
  };
}

export function deserializeRunState(data) {
  const state = createRunState(data.worldSeed || 0, data.party || []);
  if (data.creationTimestamp) state.creationTimestamp = data.creationTimestamp;
  if (data.depth) state.depth = data.depth;
  if (data.floorSubSeed) state.floorSubSeed = data.floorSubSeed;
  if (data.fogOfWar) state.fogOfWar = new Uint8Array(data.fogOfWar);
  if (data.openedContainers !== undefined) state.openedContainers = BigInt(data.openedContainers || '0');
  if (data.defeatedEnemies !== undefined) state.defeatedEnemies = BigInt(data.defeatedEnemies || '0');
  if (data.dangerClockProgress !== undefined) state.dangerClockProgress = data.dangerClockProgress;
  if (data.inventory) state.inventory = data.inventory;
  if (data.corruption !== undefined) state.corruption = data.corruption;
  if (data.credits !== undefined) state.credits = data.credits;
  if (data.scrapCounter !== undefined) state.scrapCounter = data.scrapCounter;
  if (data.themesSeen) state.themesSeen = new Set(data.themesSeen);
  if (data.echoQueue) state.echoQueue = data.echoQueue;
  if (data.rngState) state.rngState = data.rngState;
  if (data.flags) state.flags = { version: 1, calibrationFloorsReached: data.flags.calibrationFloorsReached || [] };
  if (data.partyPosition) state.partyPosition = { ...data.partyPosition };
  return state;
}