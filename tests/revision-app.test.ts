import { describe, expect, it } from 'vitest';

import { revisionApp } from '@/lib/revision-app';

const plotter = { clientId: 'plotter', name: 'Cork Harbour Course Plot' };
const desk = { clientId: 'desk', name: 'Race desk' };

describe('revisionApp', () => {
  it('names the app every change came through', () => {
    expect(revisionApp([{ via: plotter }, { via: plotter }])).toEqual(plotter);
  });

  it('names none when some changes were made in Sail Scoring itself', () => {
    expect(revisionApp([{ via: plotter }, {}])).toBeNull();
    expect(revisionApp([{}, { via: plotter }])).toBeNull();
  });

  it('names none when the changes came through different apps', () => {
    expect(revisionApp([{ via: plotter }, { via: desk }])).toBeNull();
  });

  it('names none for a revision with nothing captured, or nothing through an app', () => {
    expect(revisionApp([])).toBeNull();
    expect(revisionApp([{}])).toBeNull();
  });
});
