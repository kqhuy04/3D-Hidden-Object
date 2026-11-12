import { describe, it, expect, beforeEach } from 'vitest';
import { RoundManager } from '../src/game/missions/RoundManager';
import { HiddenItemPlacement } from '../src/data/hiddenItems';

const spot = { x: 0, z: 0 };
const make = (id: string): HiddenItemPlacement => ({
  id,
  asset: `${id}-asset`,
  name: id,
  hint: 'hint',
  spot,
  rotationY: 0,
});

const FIVE = ['a', 'b', 'c', 'd', 'e'].map(make);

describe('RoundManager (odd-object hunt)', () => {
  let round: RoundManager;

  beforeEach(() => {
    round = new RoundManager();
    round.startRound(FIVE);
  });

  it('starts with five unfound objects and no clock running down', () => {
    expect(round.getItems()).toHaveLength(5);
    expect(round.getFoundCount()).toBe(0);
    expect(round.getTotal()).toBe(5);
    expect(round.getElapsed()).toBe(0);
    expect(round.getStatus()).toBe('playing');
  });

  it('counts time up, not down', () => {
    round.update(10.5);
    expect(round.getElapsed()).toBeCloseTo(10.5, 3);
    expect(round.getElapsedLabel()).toBe('0:10');
  });

  it('formats minutes and seconds', () => {
    round.update(305);
    expect(round.getElapsedLabel()).toBe('5:05');
  });

  it('stops the clock while paused', () => {
    round.update(5);
    round.pause();
    round.update(100);
    expect(round.getElapsed()).toBeCloseTo(5, 3);
    expect(round.getStatus()).toBe('paused');

    round.resume();
    round.update(2);
    expect(round.getElapsed()).toBeCloseTo(7, 3);
  });

  it('marks an object found once, and ignores a second pickup of the same id', () => {
    expect(round.complete('c')).toBe(true);
    expect(round.getFoundCount()).toBe(1);
    expect(round.complete('c')).toBe(false);
    expect(round.getFoundCount()).toBe(1);
    expect(round.getStatus()).toBe('playing');
  });

  it('wins only when all five are in the bag', () => {
    for (const id of ['a', 'b', 'c', 'd']) round.complete(id);
    expect(round.getStatus()).toBe('playing');

    round.complete('e');
    expect(round.getStatus()).toBe('won');
    expect(round.getFoundCount()).toBe(5);
  });

  it('records when each object was found', () => {
    round.update(42);
    round.complete('b');
    expect(round.getItems().find((i) => i.placement.id === 'b')?.foundAt).toBeCloseTo(42, 3);
  });

  it('notifies listeners for each find and for the win', () => {
    const found: string[] = [];
    const states: string[] = [];
    round.onItemFound((item) => found.push(item.placement.id));
    round.onStateChange((status) => states.push(status));

    for (const id of ['a', 'b', 'c', 'd', 'e']) round.complete(id);

    expect(found).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(states).toEqual(['won']);
  });

  it('resets everything on retry', () => {
    round.update(30);
    round.complete('a');
    round.complete('b');

    round.retryRound();

    expect(round.getFoundCount()).toBe(0);
    expect(round.getElapsed()).toBe(0);
    expect(round.getStatus()).toBe('playing');
    expect(round.getItems().every((i) => !i.found && i.foundAt === undefined)).toBe(true);
  });

  it('free roam has no objects and never ends', () => {
    const free = new RoundManager();
    free.startFreeRoam();
    expect(free.isFreeRoam()).toBe(true);
    expect(free.getTotal()).toBe(0);

    free.update(9999);
    expect(free.getStatus()).toBe('playing');
  });
});
