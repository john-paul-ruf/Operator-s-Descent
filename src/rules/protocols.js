import { modifier, overclockTarget, protocolSaveDC } from './attributes.js';
import { canPrepareProtocol, getSignatureCapabilities } from './classes.js';
import { applyCondition } from './conditions.js';

const EFFECT_HANDLERS = {
  damage_single: applyDamageSingle,
  damage_splash: applyDamageSplash,
  damage_area: applyDamageArea,
  damage_chain: applyDamageChain,
  damage_ignore_defense: applyDamageIgnoreDefense,
  heal: applyHeal,
  shield: applyShield,
  shield_area: applyShieldArea,
  regen: applyRegen,
  fortress: applyFortress,
  reveal: applyReveal,
  mark: applyMark,
  blind: applyBlind,
  reveal_full: applyRevealFull,
  reveal_marked: applyRevealMarked,
  swap: applySwap,
  purge: applyPurge,
  panic: applyPanic,
  ap_penalty: applyApPenalty,
  reshape: applyReshape
};

function boundedTier(tier) {
  return Number.isInteger(tier) && tier >= 1 && tier <= 5 ? tier : null;
}

function chargeOf(caster) {
  return caster?.currentCHARGE ?? caster?.charge;
}

function withCharge(caster, charge) {
  return 'currentCHARGE' in caster ? { ...caster, currentCHARGE: charge } : { ...caster, charge };
}

function classFor(caster, context) {
  return context.classData ?? context.classesData?.classes?.find(entry => entry.id === caster?.classId);
}

function protocolFor(protocolRef, context) {
  const school = protocolRef?.school;
  const tier = boundedTier(protocolRef?.tier);
  const protocol = context.protocolsData?.schools?.[school]?.tiers?.[tier - 1];
  return protocol ? { school, tier, protocol } : null;
}

function targetKind(protocolRef, protocol) {
  if (protocol.effectData?.target === 'floor' || protocol.effectData?.target === 'all_enemies' || protocol.effectData?.target === 'enemies' || protocol.effectData?.target === 'aoe') return 'none';
  if (protocol.effectData?.type === 'reshape') return 'none';
  if (protocolRef.school === 'ward' || ['swap', 'remove_condition'].includes(protocol.effectData?.type)) return 'ally';
  return 'hostile';
}

function rangeFor(caster, protocol) {
  if (Number.isFinite(protocol.effectData?.range)) return protocol.effectData.range;
  if (protocol.range === 'adjacent') return 1;
  if (protocol.range === 'full floor') return Infinity;
  const cells = /^(\d+) cells?$/.exec(protocol.range);
  if (cells) return Number(cells[1]);
  const radius = /^(\d+)-cell radius$/.exec(protocol.range);
  if (radius) return Number(radius[1]);
  if (protocol.range === '3×3 cells') return 1;
  return Math.max(0, Number(caster?.attributes?.sig) || 0) * 2;
}

function distanceBetween(caster, target, context) {
  if (typeof context.distance === 'function') return context.distance(caster, target);
  const from = caster?.position;
  const to = target?.position;
  if (!from || !to) return 0;
  return Math.max(Math.abs(from.x - to.x), Math.abs(from.y - to.y));
}

function isHostileTarget(caster, target, context) {
  if (typeof context.isHostile === 'function') return context.isHostile(caster, target);
  return caster?.side && target?.side ? caster.side !== target.side : true;
}

function hasLineOfSight(caster, target, context) {
  const check = context.hasLineOfSight ?? context.hasLOS;
  return typeof check !== 'function' || check(caster, target);
}

function targetError(caster, targets, protocolRef, protocol, context) {
  const kind = targetKind(protocolRef, protocol);
  if (kind === 'none') return targets.length <= 1 ? null : 'invalid-target-count';
  if (targets.length !== 1 || !targets[0]) return 'invalid-target-count';
  const target = targets[0];
  if (kind === 'ally' && isHostileTarget(caster, target, context)) return 'invalid-target-side';
  if (kind === 'hostile' && !isHostileTarget(caster, target, context)) return 'invalid-target-side';
  if (distanceBetween(caster, target, context) > rangeFor(caster, protocol)) return 'out-of-range';
  if (!hasLineOfSight(caster, target, context)) return 'blocked-los';
  return null;
}

function compilerCapabilities(caster, context) {
  return context.capabilities ?? getSignatureCapabilities(caster, classFor(caster, context));
}

function overclockDetails(caster, tier, options, context) {
  if (!options.overclocked) return { cost: protocolChargeCost(tier), effectiveTier: tier, automatic: false, ignoreCorruption: false };
  const capabilities = compilerCapabilities(caster, context);
  const compile = capabilities.signatureId === 'compile' ? capabilities.effects : [];
  const double = compile.find(effect => effect.parameters?.additionalTiers === 2);
  const discount = compile.find(effect => effect.parameters?.chargeDiscount);
  const clean = compile.some(effect => effect.parameters?.ignoreCorruption);
  const multiplier = double ? double.parameters.chargeMultiplier : 2;
  const baseCost = tier * 2 * multiplier;
  const cost = discount ? Math.max(discount.parameters.minimumCharge ?? 1, baseCost - discount.parameters.chargeDiscount) : baseCost;
  return { cost, effectiveTier: tier + (double ? 2 : 1), automatic: Boolean(double?.parameters.automatic), ignoreCorruption: clean || Boolean(double) };
}

function protocolDefense(target) {
  return target?.protocolDefense ?? target?.derivedStats?.protocolDefenseBase ?? 10 + modifier(target?.attributes?.foc);
}

function rollD20(rngCursor) {
  return rngCursor?.nextInt ? rngCursor.nextInt('combat', 20) + 1 : null;
}

export function protocolChargeCost(tier, { overclocked = false, capabilities } = {}) {
  const validTier = boundedTier(tier);
  if (!validTier) return 0;
  const base = validTier * 2;
  if (!overclocked) return base;
  const effects = capabilities?.effects ?? [];
  const double = effects.find(effect => effect.parameters?.additionalTiers === 2);
  const discount = effects.find(effect => effect.parameters?.chargeDiscount);
  const cost = base * (double?.parameters?.chargeMultiplier ?? 2);
  return discount ? Math.max(discount.parameters.minimumCharge ?? 1, cost - discount.parameters.chargeDiscount) : cost;
}

export function deckSlotCost(tier) {
  return boundedTier(tier) ?? 0;
}

export function deckSlotCapacity(classChargeBase, bonusSlots = 0) {
  return Math.max(3, 3 + Math.floor(Math.max(0, Number(classChargeBase) || 0) / 2) + Math.max(0, Math.floor(Number(bonusSlots) || 0)));
}

export function validateProtocolDeck(character, classData, data) {
  const deck = character?.protocolDeck ?? character?.protocols ?? [];
  const bonusSlots = character?.extensions?.deckSlots ?? character?.deckBonusSlots ?? 0;
  const capacity = deckSlotCapacity(classData?.chargeBase, bonusSlots);
  if (!Array.isArray(deck)) return { valid: false, reason: 'invalid-deck', capacity, slotsUsed: 0 };
  const invalid = deck.filter(protocol => !protocolFor(protocol, { protocolsData: data }) || !canPrepareProtocol(classData, protocol, character?.extensions?.proficiencies));
  const slotsUsed = deck.reduce((total, protocol) => total + deckSlotCost(protocol?.tier), 0);
  if (invalid.length) return { valid: false, reason: 'invalid-protocol', capacity, slotsUsed, invalid };
  if (slotsUsed > capacity) return { valid: false, reason: 'deck-capacity', capacity, slotsUsed };
  return { valid: true, capacity, slotsUsed };
}

export function resolveProtocolAction(caster, protocolRef, targets = [], options = {}, rngCursor, context = {}) {
  const resolved = protocolFor(protocolRef, context);
  if (!caster || !resolved) return { success: false, reason: 'invalid-protocol' };
  const classData = classFor(caster, context);
  const deck = caster.protocolDeck ?? caster.protocols ?? [];
  const prepared = deck.some(protocol => protocol.school === resolved.school && protocol.tier === resolved.tier);
  if (!options.ignorePreparation && !prepared) return { success: false, reason: 'unprepared' };
  if (!options.ignoreGates && classData && !canPrepareProtocol(classData, protocolRef, caster.extensions?.proficiencies)) return { success: false, reason: 'class-gated' };
  if ((caster.conditions ?? []).some(condition => (condition.id ?? condition.conditionId) === 'jammed')) return { success: false, reason: 'jammed' };
  if (options.apAvailable === false) return { success: false, reason: 'no-ap' };
  const selectedTargets = Array.isArray(targets) ? targets : [targets].filter(Boolean);
  if (!options.ignoreTargeting) {
    const reason = targetError(caster, selectedTargets, protocolRef, resolved.protocol, context);
    if (reason) return { success: false, reason };
  }
  if (typeof context.isEffectLegal === 'function' && !context.isEffectLegal({ caster, protocol: resolved.protocol, targets: selectedTargets, options })) return { success: false, reason: 'illegal-effect' };
  const overclock = overclockDetails(caster, resolved.tier, options, context);
  if (!Number.isFinite(chargeOf(caster)) || chargeOf(caster) < overclock.cost) return { success: false, reason: 'insufficient-charge' };
  const nextCaster = withCharge(caster, chargeOf(caster) - overclock.cost);
  let overclockRoll = null;
  let overclocked = false;
  let corruptionDelta = 0;
  if (options.overclocked) {
    if (overclock.automatic) overclocked = true;
    else {
      const natural = rollD20(rngCursor);
      if (natural === null) return { success: false, reason: 'invalid-rng' };
      const rollModifier = modifier(caster.attributes?.foc);
      const target = overclockTarget(resolved.tier);
      overclocked = natural + rollModifier >= target;
      overclockRoll = { natural, modifier: rollModifier, total: natural + rollModifier, target, success: overclocked };
      if (!overclocked && !overclock.ignoreCorruption) corruptionDelta = 0.05;
    }
  }
  let attackRoll = null;
  const hostile = targetKind(protocolRef, resolved.protocol) === 'hostile';
  let hit = true;
  if (hostile && selectedTargets.length) {
    const natural = rollD20(rngCursor);
    if (natural === null) return { success: false, reason: 'invalid-rng' };
    const rollModifier = modifier(caster.attributes?.foc);
    const target = protocolDefense(selectedTargets[0]);
    const total = natural + rollModifier;
    hit = natural !== 1 && (natural === 20 || total >= target);
    attackRoll = { natural, modifier: rollModifier, total, target, hit };
  }
  const effectSucceeds = !options.overclocked || overclocked;
  const runState = context.runState && corruptionDelta ? { ...context.runState, corruption: (context.runState.corruption ?? 0) + corruptionDelta } : context.runState;
  return {
    success: true,
    protocol: { school: resolved.school, tier: resolved.tier, name: resolved.protocol.name },
    costs: { charge: overclock.cost, ap: 1, overclocked: Boolean(options.overclocked) },
    targets: selectedTargets.map(target => target?.id ?? null),
    rolls: { attack: attackRoll, overclock: overclockRoll },
    hit,
    overclocked,
    effectiveTier: effectSucceeds ? overclock.effectiveTier : resolved.tier,
    corruptionDelta,
    stateDelta: { caster: nextCaster, runState, corruption: corruptionDelta },
    effectRequest: effectSucceeds && (!hostile || hit) ? { protocol: resolved.protocol, effectId: resolved.protocol.effectData.effectId, school: resolved.school, tier: resolved.tier, effectiveTier: overclock.effectiveTier, targets: selectedTargets, dc: protocolSaveDC(caster, overclock.effectiveTier), attackRoll } : null
  };
}

function rollDice(rngCursor, count, sides) {
  let total = 0;
  for (let index = 0; index < count; index++) total += rngCursor.nextInt('combat', sides) + 1;
  return total;
}

function effectActors(caster, request, context) {
  const supplied = context.actors instanceof Map ? [...context.actors.values()] : Array.isArray(context.actors) ? context.actors : context.combatants instanceof Map ? [...context.combatants.values()] : [];
  const actors = [caster, ...supplied, ...(request.targets ?? [])].filter(Boolean);
  return [...new Map(actors.map(actor => [actor.id ?? actor, actor])).values()];
}

function actorHp(actor) {
  return actor?.currentHP ?? actor?.hp ?? 0;
}

function withActorHp(actor, nextHp) {
  const next = { ...actor };
  if ('hp' in actor || !('currentHP' in actor)) next.hp = nextHp;
  if ('currentHP' in actor) next.currentHP = nextHp;
  return next;
}

function actorHpMax(actor) {
  return actor?.maxHP ?? actor?.hpMax ?? Infinity;
}

function cloneActor(actor) {
  return { ...actor, position: actor?.position ? { ...actor.position } : actor?.position, conditions: (actor?.conditions ?? []).map(condition => ({ ...condition })) };
}

function chebyshev(a, b) {
  if (!a?.position || !b?.position) return Infinity;
  return Math.max(Math.abs(a.position.x - b.position.x), Math.abs(a.position.y - b.position.y));
}

function createEffectState(caster, request, context) {
  const originals = effectActors(caster, request, context);
  const updates = new Map();
  const get = actor => {
    const id = actor?.id;
    if (id === undefined) return actor;
    if (!updates.has(id)) updates.set(id, cloneActor(actor));
    return updates.get(id);
  };
  const all = () => originals.map(get);
  return { originals, updates, get, all, events: [], markers: {}, temporaryEffects: {}, apDebt: {}, grid: null };
}

function actorById(state, actor) {
  return state.get(state.originals.find(entry => entry.id === actor?.id) ?? actor);
}

function living(actor) {
  return actorHp(actor) > 0;
}

function hostileActors(caster, state, context) {
  return state.all().filter(actor => actor.id !== caster.id && living(actor) && isHostileTarget(caster, actor, context));
}

function alliedActors(caster, state, context) {
  return state.all().filter(actor => living(actor) && !isHostileTarget(caster, actor, context));
}

function effectDamage(caster, target, request, state, rngCursor, { count = request.effectiveTier, sides = 6, maximum = false, label = 'damage' } = {}) {
  const rolls = maximum ? Array.from({ length: count }, () => sides) : Array.from({ length: count }, () => rngCursor.nextInt('combat', sides) + 1);
  const amount = Math.max(0, rolls.reduce((total, roll) => total + roll, 0) + modifier(caster.attributes?.res));
  const next = actorById(state, target);
  const hp = Math.max(0, actorHp(next) - amount);
  const updated = withActorHp(next, hp);
  state.updates.set(updated.id, updated);
  state.events.push({ type: label, targetId: updated.id, rolls, amount, died: hp === 0 });
  return updated;
}

function effectHeal(caster, target, request, state, rngCursor, count = request.effectiveTier) {
  const rolls = Array.from({ length: count }, () => rngCursor.nextInt('combat', 6) + 1);
  const amount = Math.max(0, rolls.reduce((total, roll) => total + roll, 0) + modifier(caster.attributes?.res));
  const next = actorById(state, target);
  const healed = Math.min(actorHpMax(next), actorHp(next) + amount);
  const updated = withActorHp(next, healed);
  state.updates.set(updated.id, updated);
  state.events.push({ type: 'heal', targetId: updated.id, rolls, amount: healed - actorHp(next) });
  return updated;
}

function areaCenter(caster, request) {
  return request.targets?.[0] ?? caster;
}

function targetsInRadius(caster, request, state, context, side, radius) {
  const center = areaCenter(caster, request);
  const actors = side === 'ally' ? alliedActors(caster, state, context) : hostileActors(caster, state, context);
  return actors
    .filter(actor => chebyshev(center, actor) <= radius)
    .sort((a, b) => chebyshev(center, a) - chebyshev(center, b) || String(a.id).localeCompare(String(b.id)));
}

function applyConditionEffect(caster, target, conditionId, request, state, context, rngCursor) {
  const next = actorById(state, target);
  const applied = applyCondition(next, conditionId, { dc: request.dc, noSave: conditionId === 'marked' }, rngCursor, context.conditionsData?.conditions ?? context.conditionsData);
  state.updates.set(next.id, next);
  state.events.push(...(applied.events ?? []));
  return applied;
}

function applyDamageSingle(caster, request, state, context, rngCursor) {
  effectDamage(caster, request.targets[0], request, state, rngCursor, { maximum: request.attackRoll?.natural === 20 });
}

function applyDamageSplash(caster, request, state, context, rngCursor) {
  const primary = effectDamage(caster, request.targets[0], request, state, rngCursor, { maximum: request.attackRoll?.natural === 20 });
  for (const target of hostileActors(caster, state, context).filter(actor => actor.id !== primary.id && chebyshev(primary, actor) <= 1)) {
    effectDamage(caster, target, request, state, rngCursor, { count: 1, sides: 4, label: 'splash' });
  }
}

function applyDamageArea(caster, request, state, context, rngCursor) {
  for (const target of targetsInRadius(caster, request, state, context, 'hostile', request.protocol.effectData.radius)) {
    effectDamage(caster, target, request, state, rngCursor, { maximum: request.attackRoll?.natural === 20 });
  }
}

function applyDamageChain(caster, request, state, context, rngCursor) {
  let target = request.targets[0];
  while (target && living(target)) {
    const defeated = effectDamage(caster, target, request, state, rngCursor, { maximum: request.attackRoll?.natural === 20 });
    if (living(defeated)) break;
    target = hostileActors(caster, state, context)
      .filter(actor => actor.id !== defeated.id)
      .sort((a, b) => chebyshev(defeated, a) - chebyshev(defeated, b) || String(a.id).localeCompare(String(b.id)))[0];
  }
}

function applyDamageIgnoreDefense(caster, request, state, context, rngCursor) {
  effectDamage(caster, request.targets[0], request, state, rngCursor, { maximum: request.attackRoll?.natural === 20, label: 'damage_ignore_defense' });
}

function applyHeal(caster, request, state, context, rngCursor) {
  effectHeal(caster, request.targets[0], request, state, rngCursor);
}

function applyShield(caster, request, state, context, rngCursor) {
  applyConditionEffect(caster, request.targets[0], 'shielded', request, state, context, rngCursor);
}

function applyShieldArea(caster, request, state, context, rngCursor) {
  for (const target of targetsInRadius(caster, request, state, context, 'ally', request.protocol.effectData.radius)) {
    applyConditionEffect(caster, target, 'shielded', request, state, context, rngCursor);
    state.temporaryEffects[target.id] = { defenseBonus: request.protocol.effectData.defenseBonus, duration: request.protocol.effectData.duration };
  }
}

function applyRegen(caster, request, state) {
  const target = actorById(state, request.targets[0]);
  state.temporaryEffects[target.id] = { regen: { die: 'd6', modifier: modifier(caster.attributes?.res), duration: request.effectiveTier } };
  state.events.push({ type: 'regen_applied', targetId: target.id, duration: request.effectiveTier });
}

function applyFortress(caster, request, state, context) {
  for (const target of targetsInRadius(caster, request, state, context, 'ally', request.protocol.effectData.radius)) {
    state.temporaryEffects[target.id] = { defenseBonus: request.protocol.effectData.defenseBonus, conditionImmunity: true, duration: request.protocol.effectData.duration };
    state.events.push({ type: 'fortress_applied', targetId: target.id, duration: request.protocol.effectData.duration });
  }
}

function applyReveal(caster, request, state, context) {
  state.markers.revealedEnemies = hostileActors(caster, state, context).filter(actor => chebyshev(caster, actor) <= request.protocol.effectData.radius).map(actor => actor.id);
  state.markers.revealDuration = request.effectiveTier;
  state.events.push({ type: 'reveal', targetIds: state.markers.revealedEnemies, duration: request.effectiveTier });
}

function applyMark(caster, request, state, context, rngCursor) {
  applyConditionEffect(caster, request.targets[0], 'marked', request, state, context, rngCursor);
}

function applyBlind(caster, request, state, context, rngCursor) {
  applyConditionEffect(caster, request.targets[0], 'blinded', request, state, context, rngCursor);
}

function applyRevealFull(caster, request, state, context) {
  state.markers.revealFloor = true;
  state.markers.revealContainers = true;
  state.markers.revealDescent = true;
  state.events.push({ type: 'reveal_full' });
}

function applyRevealMarked(caster, request, state, context, rngCursor) {
  const targets = hostileActors(caster, state, context);
  state.markers.revealedEnemies = targets.map(target => target.id);
  state.markers.revealDuration = request.protocol.effectData.duration;
  for (const target of targets) applyConditionEffect(caster, target, 'marked', request, state, context, rngCursor);
}

function legalCell(position, state, context, ignoreIds) {
  if (!position || !Number.isInteger(position.x) || !Number.isInteger(position.y)) return false;
  if (typeof context.isLegalCell === 'function' && !context.isLegalCell(position)) return false;
  const grid = context.floor?.cells ?? context.grid ?? context.lattice?.getGrid?.();
  if (grid && (position.y < 0 || position.y >= grid.length || position.x < 0 || position.x >= grid[0].length || grid[position.y][position.x] === 0)) return false;
  return !state.all().some(actor => !ignoreIds.includes(actor.id) && actor.position?.x === position.x && actor.position?.y === position.y);
}

function applySwap(caster, request, state, context) {
  const source = actorById(state, caster);
  const target = actorById(state, request.targets[0]);
  if (!legalCell(source.position, state, context, [source.id, target.id]) || !legalCell(target.position, state, context, [source.id, target.id])) {
    state.events.push({ type: 'swap_rejected', reason: 'illegal_cells' });
    return;
  }
  state.updates.set(source.id, { ...source, position: { ...target.position } });
  state.updates.set(target.id, { ...target, position: { ...source.position } });
  state.events.push({ type: 'swap', sourceId: source.id, targetId: target.id });
}

function applyPurge(caster, request, state) {
  const target = actorById(state, request.targets[0]);
  const conditionId = request.conditionId ?? target.conditions?.[0]?.id ?? target.conditions?.[0]?.conditionId;
  if (!conditionId) return;
  const updated = { ...target, conditions: target.conditions.filter(condition => (condition.id ?? condition.conditionId) !== conditionId) };
  state.updates.set(updated.id, updated);
  state.events.push({ type: 'condition_cleared', conditionId, targetId: updated.id });
}

function applyPanic(caster, request, state, context, rngCursor) {
  applyConditionEffect(caster, request.targets[0], 'panicked', request, state, context, rngCursor);
}

function applyApPenalty(caster, request, state, context) {
  for (const target of targetsInRadius(caster, request, state, context, 'hostile', request.protocol.effectData.radius)) {
    state.apDebt[target.id] = (state.apDebt[target.id] ?? 0) + request.protocol.effectData.apLoss;
    state.events.push({ type: 'ap_debt', targetId: target.id, amount: request.protocol.effectData.apLoss });
  }
}

function reachabilityPreserved(floor, cells) {
  const grid = cells;
  const open = (x, y) => grid[y]?.[x] !== undefined && grid[y][x] !== 0;
  const start = floor.startPoint ?? floor.partyPosition ?? floor.descentPoint;
  const origin = start && open(start.x, start.y) ? start : (() => {
    for (let y = 0; y < grid.length; y++) for (let x = 0; x < grid[0].length; x++) if (open(x, y)) return { x, y };
    return null;
  })();
  if (!origin) return false;
  const visited = new Set([`${origin.x},${origin.y}`]);
  const queue = [origin];
  for (let index = 0; index < queue.length; index++) {
    const { x, y } = queue[index];
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const next = { x: x + dx, y: y + dy };
      const key = `${next.x},${next.y}`;
      if (open(next.x, next.y) && !visited.has(key)) {
        visited.add(key);
        queue.push(next);
      }
    }
  }
  const required = [floor.descentPoint, ...(floor.containers ?? [])].filter(Boolean);
  return required.every(point => open(point.x, point.y) && visited.has(`${point.x},${point.y}`));
}

function applyReshape(caster, request, state, context) {
  const floor = context.floor ?? { cells: context.grid, descentPoint: context.descentPoint, containers: context.containers };
  const grid = floor?.cells;
  const center = request.areaCenter ?? context.areaCenter ?? request.targets?.[0]?.position;
  if (!Array.isArray(grid) || !center || center.x < 1 || center.y < 1 || center.y >= grid.length - 1 || center.x >= grid[0].length - 1) {
    state.events.push({ type: 'reshape_rejected', reason: 'invalid_area' });
    return;
  }
  const cells = grid.map(row => [...row]);
  const mode = request.reshapeMode ?? context.reshapeMode;
  const targetValue = mode === 'wall' ? 0 : mode === 'floor' ? 1 : grid[center.y][center.x] === 0 ? 1 : 0;
  for (let y = center.y - 1; y <= center.y + 1; y++) for (let x = center.x - 1; x <= center.x + 1; x++) {
    if (state.all().some(actor => actor.position?.x === x && actor.position?.y === y)) {
      state.events.push({ type: 'reshape_rejected', reason: 'occupied' });
      return;
    }
    cells[y][x] = targetValue;
  }
  if (!reachabilityPreserved(floor, cells)) {
    state.events.push({ type: 'reshape_rejected', reason: 'connectivity' });
    return;
  }
  state.grid = cells;
  state.events.push({ type: 'reshape', areaCenter: { ...center }, mode: targetValue === 0 ? 'wall' : 'floor' });
}

export function applyProtocolEffect(caster, request, context = {}, rngCursor) {
  const effectRequest = request?.effectRequest ?? request;
  const effectId = effectRequest?.effectId ?? effectRequest?.protocol?.effectData?.effectId;
  const handler = EFFECT_HANDLERS[effectId];
  if (!caster || !handler || !rngCursor?.nextInt) return { success: false, reason: !handler ? 'invalid-effect' : 'invalid-rng' };
  const state = createEffectState(caster, effectRequest, context);
  handler(caster, effectRequest, state, context, rngCursor);
  return {
    success: true,
    effectId,
    events: state.events,
    stateDelta: {
      actors: [...state.updates.values()],
      markers: state.markers,
      temporaryEffects: state.temporaryEffects,
      apDebt: state.apDebt,
      ...(state.grid ? { grid: state.grid } : {})
    }
  };
}

function applyLegacyEffect(caster, request, conditionsData, rngCursor) {
  const targets = request.effectRequest?.targets ?? [];
  const applied = applyProtocolEffect(caster, request, { conditionsData, actors: [caster, ...targets] }, rngCursor);
  if (!applied.success) return applied;
  const originals = new Map([caster, ...targets].map(actor => [actor.id, actor]));
  for (const actor of applied.stateDelta.actors) Object.assign(originals.get(actor.id), actor);
  const events = applied.events;
  return {
    damage: events.filter(event => event.type === 'damage' || event.type === 'splash' || event.type === 'damage_ignore_defense').reduce((total, event) => total + (event.amount ?? 0), 0),
    healed: events.filter(event => event.type === 'heal').reduce((total, event) => total + (event.amount ?? 0), 0),
    conditionsApplied: events.filter(event => event.type.startsWith('condition_')),
    protocolName: request.protocol.name,
    ...applied
  };
}

function applyLegacyCharge(caster, nextCaster) {
  if ('currentCHARGE' in caster) caster.currentCHARGE = nextCaster.currentCHARGE;
  else caster.charge = nextCaster.charge;
}

export function castProtocol(caster, school, tier, target, protocolsData, conditionsData, rngCursor) {
  const action = resolveProtocolAction(caster, { school, tier }, target ? [target] : [], { ignorePreparation: true, ignoreGates: true, ignoreTargeting: true }, rngCursor, { protocolsData });
  if (!action.success) return action;
  applyLegacyCharge(caster, action.stateDelta.caster);
  return { success: true, result: action.effectRequest ? applyLegacyEffect(caster, action, conditionsData, rngCursor) : null };
}

export function overclockProtocol(caster, school, tier, target, protocolsData, conditionsData, rngCursor) {
  const action = resolveProtocolAction(caster, { school, tier }, target ? [target] : [], { overclocked: true, ignorePreparation: true, ignoreGates: true, ignoreTargeting: true }, rngCursor, { protocolsData });
  if (!action.success) return action;
  applyLegacyCharge(caster, action.stateDelta.caster);
  return {
    success: true,
    overclocked: action.overclocked,
    corruptionAdded: action.corruptionDelta,
    result: action.effectRequest ? applyLegacyEffect(caster, action, conditionsData, rngCursor) : null,
    roll: action.rolls.overclock?.total,
    threshold: action.rolls.overclock?.target
  };
}
