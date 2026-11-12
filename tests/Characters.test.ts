// The roster is data too, and it fails the same quiet way the hunt content
// does: a character listed in `characters.ts` but never downloaded leaves the
// start screen showing a blank portrait and the game loading a 404 body, with
// nothing thrown until someone presses Play.
//
// These are integrity checks. Whether a knight in a ski queue is funny is not
// testable and lives in the data file's comments.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  CHARACTERS,
  DEFAULT_CHARACTER_ID,
  characterFor,
  characterModelUrl,
  stepCharacter,
} from '../src/data/characters';

const ASSET_DIR = path.join(process.cwd(), 'public', 'assets', 'characters');

describe('character roster', () => {
  it('has twelve characters', () => {
    expect(CHARACTERS).toHaveLength(12);
  });

  it('gives every character a unique id', () => {
    const ids = CHARACTERS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every character a name and a blurb', () => {
    for (const c of CHARACTERS) {
      expect(c.name.trim().length, c.id).toBeGreaterThan(1);
      expect(c.blurb.trim().length, c.id).toBeGreaterThan(8);
      // The start screen draws the blurb on one line. A sentence that has to be
      // cut in half is a sentence that should not be there.
      expect(c.blurb.length, c.id).toBeLessThan(56);
    }
  });

  it('ships a model for every character', () => {
    for (const c of CHARACTERS) {
      const file = path.join(ASSET_DIR, `${c.id}.glb`);
      expect(existsSync(file), `${c.id} is listed but not downloaded`).toBe(true);
    }
  });

  it('credits every character', () => {
    const credits = JSON.parse(readFileSync(path.join(ASSET_DIR, 'CREDITS.json'), 'utf8'));
    const listed = new Set(
      (Array.isArray(credits) ? credits : credits.characters ?? []).map(
        (row: { id?: string }) => row.id
      )
    );
    for (const c of CHARACTERS) {
      expect(listed.has(c.id), `${c.id} has no credit line`).toBe(true);
    }
  });

  it('points the model url at the shipped folder', () => {
    expect(characterModelUrl('backpacker-f56207')).toBe(
      '/assets/characters/backpacker-f56207.glb'
    );
  });

  it('keeps the default in the roster', () => {
    expect(CHARACTERS.some((c) => c.id === DEFAULT_CHARACTER_ID)).toBe(true);
  });

  it('falls back instead of leaving the player with no body', () => {
    expect(characterFor(null).id).toBe(DEFAULT_CHARACTER_ID);
    expect(characterFor('').id).toBe(DEFAULT_CHARACTER_ID);
    expect(characterFor('a-character-that-was-removed').id).toBe(DEFAULT_CHARACTER_ID);
    expect(characterFor('backpacker-f56207').id).toBe('backpacker-f56207');
  });

  it('wraps in both directions', () => {
    const first = CHARACTERS[0];
    const last = CHARACTERS[CHARACTERS.length - 1];
    expect(stepCharacter(first.id, -1).id).toBe(last.id);
    expect(stepCharacter(last.id, 1).id).toBe(first.id);
    expect(stepCharacter(first.id, 1).id).toBe(CHARACTERS[1].id);
  });
});
