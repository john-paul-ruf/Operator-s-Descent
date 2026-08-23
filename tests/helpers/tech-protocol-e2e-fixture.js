import { createGameHarness, loadGameDataFixture, roundTripRunState, startStandardCombat } from './game-fixture.js';
import { toCombatSnapshot } from '../../src/rules/combat.js';

export const TECH_PROTOCOL_FIXTURE_SEED = 20_260_823;

function catalogFrom(data) {
  const catalog = Object.entries(data.protocols.schools).flatMap(([school, entry]) => entry.tiers.map(protocol => ({
    school,
    tier: protocol.tier,
    id: `${school}-${protocol.tier}`,
    name: protocol.name,
    chargeCost: protocol.chargeCost,
    effect: protocol.effect,
    effectData: protocol.effectData
  })));
  if (catalog.length !== 20 || new Set(catalog.map(entry => entry.school)).size !== 4 || catalog.some(entry => entry.chargeCost !== entry.tier * 2)) {
    throw new Error('protocol catalog must contain four five-tier schools with tier × 2 costs');
  }
  return catalog;
}

const TARGETLESS = new Set(['scry-1', 'scry-4', 'scry-5', 'rewrite-4', 'rewrite-5']);

function expectedFor(protocol) {
  const id = protocol.id;
  const damage = id.startsWith('disrupt-');
  const expected = {
    chargeSpent: protocol.chargeCost,
    apSpent: 1,
    targetless: TARGETLESS.has(id),
    outcome(snapshot, before, ids) {
      const actors = snapshot.activeCombat?.actors || [];
      const actor = (actorId) => actors.find(entry => entry.id === actorId);
      const primary = actor(ids.primary);
      const ally = actor(ids.ally);
      const enemies = ids.enemies.map(actor).filter(Boolean);
      if (!primary || primary.charge !== before.casterCharge - protocol.chargeCost || primary.ap !== before.casterAP - 1) return false;
      if (damage) return enemies.some(entry => entry.hp < before.enemyHP[entry.id]);
      if (id === 'ward-1') return ally.hp > before.allyHP;
      if (['ward-2', 'ward-3'].includes(id)) return ally.conditions.some(condition => condition.id === 'shielded');
      if (id === 'rewrite-1') return primary.x === before.allyPosition.x && primary.y === before.allyPosition.y;
      if (id === 'rewrite-2') return !ally.conditions.some(condition => condition.id === 'burning');
      if (['scry-2', 'scry-3', 'rewrite-3'].includes(id)) return enemies.some(entry => entry.conditions.length > before.enemyConditionCounts[entry.id]);
      return snapshot.activeCombat?.actors?.length > 0;
    }
  };
  return expected;
}

export const TECH_PROTOCOL_CASES = catalogFrom(loadGameDataFixture()).map(protocol => ({
  ...protocol,
  target: TARGETLESS.has(protocol.id) ? null : (protocol.school === 'ward' || protocol.id.startsWith('rewrite-1') || protocol.id.startsWith('rewrite-2') ? 'ally' : 'primary'),
  expected: expectedFor(protocol)
}));

function setActor(combatState, id, changes) {
  Object.assign(combatState.combatants.get(id), changes);
}

export function buildTechProtocolFixture(caseDescriptor) {
  const data = loadGameDataFixture();
  const harness = createGameHarness({ seed: TECH_PROTOCOL_FIXTURE_SEED + caseDescriptor.tier, partySize: 2 });
  const caster = harness.runState.party[0];
  const ally = harness.runState.party[1];
  caster.classId = 'compiler';
  caster.attributes = { mgt: 5, fin: 5, vit: 5, res: 10, foc: 10, sig: 10 };
  caster.protocolDeck = [{ school: caseDescriptor.school, tier: caseDescriptor.tier }];
  caster.currentCHARGE = 30;
  ally.currentHP = 1;
  ally.conditions = caseDescriptor.id === 'rewrite-2' ? [{ conditionId: 'burning', duration: 3, stacks: 1 }] : [];

  const combat = startStandardCombat(harness, { enemyCount: 3, enemyHP: 12 });
  const partyActors = [...combat.combatState.combatants.values()].filter(actor => actor.side === 'party');
  const enemyActors = [...combat.combatState.combatants.values()].filter(actor => actor.side === 'enemy');
  const casterActor = partyActors.find(actor => actor.id === caster.id);
  const allyActor = partyActors.find(actor => actor.id === ally.id);
  const primary = enemyActors[0];
  const ids = { primary: primary.id, ally: allyActor.id, enemies: enemyActors.map(actor => actor.id) };
  setActor(combat.combatState, casterActor.id, { classId: 'compiler', attributes: caster.attributes, protocols: caster.protocolDeck, protocolDeck: caster.protocolDeck, charge: 30, chargeMax: 30, ap: 2, position: { x: 2, y: 2 } });
  setActor(combat.combatState, allyActor.id, { hp: 1, currentHP: 1, conditions: ally.conditions.map(condition => ({ id: condition.conditionId, ...condition })), position: { x: 3, y: 2 } });
  enemyActors.forEach((actor, index) => setActor(combat.combatState, actor.id, { hp: caseDescriptor.id === 'disrupt-4' && index === 0 ? 1 : 12, hpMax: 12, protocolDefense: 1, attributes: { mgt: 1, fin: 1, vit: 1, res: 1, foc: 1, sig: 1 }, position: { x: 4 + index, y: 2 } }));
  combat.combatState.turnOrder = [casterActor.id, ...combat.combatState.turnOrder.filter(id => id !== casterActor.id)];
  combat.combatState.currentTurn = 0;
  const before = {
    casterCharge: 30,
    casterAP: 2,
    allyHP: 1,
    allyPosition: { x: 3, y: 2 },
    enemyHP: Object.fromEntries(enemyActors.map(actor => [actor.id, actor.hp])),
    enemyConditionCounts: Object.fromEntries(enemyActors.map(actor => [actor.id, actor.conditions.length]))
  };
  harness.runState.setActiveCombat(toCombatSnapshot(combat.combatState));
  const { encoded, decoded } = roundTripRunState(harness.runState);
  if (encoded.fragment.length >= 1500 || !decoded.activeCombat) throw new Error(`invalid protocol fixture ${caseDescriptor.id}`);
  return { fragment: encoded.fragment, ids, before, protocol: caseDescriptor, expected: caseDescriptor.expected };
}

export function buildAllTechProtocolFixtures() {
  return TECH_PROTOCOL_CASES.map(caseDescriptor => ({ caseDescriptor, fixture: buildTechProtocolFixture(caseDescriptor) }));
}
