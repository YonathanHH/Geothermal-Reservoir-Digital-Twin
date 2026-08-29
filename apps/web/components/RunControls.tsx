'use client';

import { useEffect, useState } from 'react';

/** Light/dark toggle. Cycles through the OS default rather than forcing a choice. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null);

  useEffect(() => {
    const stored = document.documentElement.dataset.theme;
    setTheme(stored === 'dark' || stored === 'light' ? stored : null);
  }, []);

  const apply = (next: 'light' | 'dark' | null) => {
    setTheme(next);
    if (next) {
      document.documentElement.dataset.theme = next;
      localStorage.setItem('geo-theme', next);
    } else {
      delete document.documentElement.dataset.theme;
      localStorage.removeItem('geo-theme');
    }
  };

  const label = theme === null ? 'System' : theme === 'dark' ? 'Dark' : 'Light';

  return (
    <button
      type="button"
      className="button button--ghost"
      onClick={() => apply(theme === null ? 'light' : theme === 'light' ? 'dark' : null)}
      aria-label={`Colour theme: ${label}. Activate to change.`}
    >
      Theme: {label}
    </button>
  );
}

interface RunControlsProps {
  n: number;
  seed: number;
  lifetimeYears: number;
  busy: boolean;
  onChange: (patch: { n?: number; seed?: number; lifetimeYears?: number }) => void;
  onReset: () => void;
}

const SAMPLE_COUNTS = [500, 1000, 2000, 5000, 10000];

/** Simulation settings: everything that changes the run but not the physics. */
export function RunControls({ n, seed, lifetimeYears, busy, onChange, onReset }: RunControlsProps) {
  return (
    <div className="controls">
      <div className="control">
        <label htmlFor="control-n">Realizations</label>
        <select
          id="control-n"
          className="cell-input"
          value={n}
          onChange={(event) => onChange({ n: Number(event.target.value) })}
        >
          {SAMPLE_COUNTS.map((count) => (
            <option key={count} value={count}>
              {count.toLocaleString('en-US')}
            </option>
          ))}
        </select>
      </div>

      <div className="control">
        <label htmlFor="control-seed">Seed</label>
        <input
          id="control-seed"
          type="number"
          className="cell-input tabular"
          value={seed}
          min={0}
          onChange={(event) => onChange({ seed: Number(event.target.value) })}
        />
      </div>

      <div className="control">
        <label htmlFor="control-life">Project lifetime</label>
        <input
          id="control-life"
          type="number"
          className="cell-input tabular"
          value={lifetimeYears}
          min={1}
          max={100}
          onChange={(event) => onChange({ lifetimeYears: Number(event.target.value) })}
        />
      </div>

      <button type="button" className="button" onClick={onReset}>
        Reset to defaults
      </button>

      <span className="controls__status" role="status" aria-live="polite">
        {busy ? 'Recomputing…' : ''}
      </span>
    </div>
  );
}
