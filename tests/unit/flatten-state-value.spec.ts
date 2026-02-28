import { flattenStateValue } from '../../src/utils/flatten-state-value';

describe('flattenStateValue', () => {
  it('should pass through a flat string state', () => {
    expect(flattenStateValue('idle')).toBe('idle');
  });

  it('should flatten a single-level nested state', () => {
    expect(flattenStateValue({ picking: 'active' })).toBe('picking.active');
  });

  it('should flatten a multi-level nested state', () => {
    expect(flattenStateValue({ picking: { review: 'pending' } })).toBe(
      'picking.review.pending',
    );
  });

  it('should handle deeply nested states', () => {
    expect(flattenStateValue({ a: { b: { c: { d: 'leaf' } } } })).toBe(
      'a.b.c.d.leaf',
    );
  });

  it('should handle single-word string state', () => {
    expect(flattenStateValue('done')).toBe('done');
  });
});
