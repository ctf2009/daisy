import { describe, it, expect } from 'vitest';
import { generateId, generateSlug } from '../src/lib/tokens';

describe('generateId', () => {
  it('returns a valid UUID', () => {
    const id = generateId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('returns unique values', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});

describe('generateSlug', () => {
  it('creates a slug from a name', () => {
    const slug = generateSlug('My Event');
    expect(slug).toMatch(/^my-event-[a-f0-9]{6}$/);
  });

  it('strips special characters', () => {
    const slug = generateSlug("Summer BBQ & Fun!");
    expect(slug).toMatch(/^summer-bbq-fun-[a-f0-9]{6}$/);
  });

  it('collapses multiple spaces and hyphens', () => {
    const slug = generateSlug('too   many   spaces');
    expect(slug).toMatch(/^too-many-spaces-[a-f0-9]{6}$/);
  });

  it('truncates long names', () => {
    const slug = generateSlug('a'.repeat(100));
    // base is sliced to 30 chars + hyphen + 6 char suffix = max 37
    expect(slug.length).toBeLessThanOrEqual(37);
  });

  it('handles empty-ish names', () => {
    const slug = generateSlug('!!!');
    // Special chars stripped, base is empty, just suffix
    expect(slug).toMatch(/^-?[a-f0-9]{6}$/);
  });

  it('generates unique slugs for the same name', () => {
    const slugs = new Set(Array.from({ length: 50 }, () => generateSlug('Same Name')));
    expect(slugs.size).toBe(50);
  });
});
