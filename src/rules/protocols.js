import { modifier, overclockTarget, protocolSaveDC } from './attributes.js';
import { canPrepareProtocol, getSignatureCapabilities } from './classes.js';
import { applyCondition } from './conditions.js';

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
  if (protocol.effectData?.target === 'floor' || protocol.effectData?.target === 'all_enemies' || protocol.effectData?.target === 'enemies') return 'none';
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
  if (kind === 'none') return targets.length === 0 ? null : 'invalid-target-count';
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
    effectRequest: effectSucceeds && (!hostile || hit) ? { protocol: resolved.protocol, school: resolved.school, tier: resolved.tier, effectiveTier: overclock.effectiveTier, targets: selectedTargets, dc: protocolSaveDC(caster, overclock.effectiveTier) } : null
  };
}

function rollDice(rngCursor, count, sides) {
  let total = 0;
  for (let index = 0; index < count; index++) total += rngCursor.nextInt('combat', sides) + 1;
  return total;
}

function applyLegacyEffect(caster, request, conditionsData, rngCursor) {
  const effect = request.effectRequest?.protocol.effectData ?? {};
  const target = request.effectRequest?.targets?.[0];
  const result = { damage: 0, healed: 0, conditionsApplied: [], protocolName: request.protocol.name };
  if (effect.type === 'damage' && target) {
    const sides = Number(effect.die?.slice(1)) || 6;
    result.damage = rollDice(rngCursor, request.effectiveTier, sides) + modifier(caster.attributes?.res);
    if (target.hp !== undefined) target.hp = Math.max(0, target.hp - result.damage);
  } else if (effect.type === 'heal' && target) {
    const sides = Number(effect.die?.slice(1)) || 6;
    result.healed = rollDice(rngCursor, request.effectiveTier, sides) + modifier(caster.attributes?.res);
    if (target.hp !== undefined) target.hp = Math.min(target.hpMax ?? Infinity, target.hp + result.healed);
  } else if (effect.type === 'condition' && target) {
    const applied = applyCondition(target, effect.condition, { dc: request.effectRequest.dc }, rngCursor, conditionsData);
    result.conditionsApplied.push({ target: target.id, condition: effect.condition, ...applied });
  }
  return result;
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
