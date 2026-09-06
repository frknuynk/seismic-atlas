'use client';

import { Layers3, SlidersHorizontal } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import type { AtlasFilters } from '@/shared/atlas-state';

const timeRanges = [
  { hours: 24, label: '24 hours' },
  { hours: 72, label: '3 days' },
  { hours: 168, label: '7 days' },
] as const;

function firstSliderValue(value: number | readonly number[], fallback: number) {
  return typeof value === 'number' ? value : (value[0] ?? fallback);
}

type FilterControlsProps = {
  filters: AtlasFilters;
  resultCount: number;
  onChange: (filters: AtlasFilters) => void;
};

export function FilterControls({
  filters,
  resultCount,
  onChange,
}: FilterControlsProps) {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <SlidersHorizontal
            className="size-4 text-primary"
            aria-hidden="true"
          />
          Explore
        </div>
        <span className="text-xs text-muted-foreground">
          {resultCount.toLocaleString()} visible
        </span>
      </div>

      <fieldset>
        <legend className="mb-2 text-xs font-medium text-muted-foreground">
          Time window
        </legend>
        <div className="grid grid-cols-3 gap-1.5">
          {timeRanges.map((range) => (
            <button
              key={range.hours}
              type="button"
              onClick={() => onChange({ ...filters, rangeHours: range.hours })}
              aria-pressed={filters.rangeHours === range.hours}
              className="rounded-md border px-2 py-2 text-xs transition hover:bg-accent aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-primary"
            >
              {range.label}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="block">
        <span className="mb-3 flex items-center justify-between text-xs font-medium text-muted-foreground">
          Minimum magnitude
          <output className="font-mono text-foreground">
            M {filters.minMagnitude.toFixed(1)}+
          </output>
        </span>
        <Slider
          value={[filters.minMagnitude]}
          min={0}
          max={6}
          step={0.5}
          onValueChange={(value) =>
            onChange({
              ...filters,
              minMagnitude: firstSliderValue(value, 0),
            })
          }
          aria-label="Minimum earthquake magnitude"
        />
      </label>

      <label className="block">
        <span className="mb-3 flex items-center justify-between text-xs font-medium text-muted-foreground">
          Maximum depth
          <output className="font-mono text-foreground">
            {filters.maxDepth} km
          </output>
        </span>
        <Slider
          value={[filters.maxDepth]}
          min={10}
          max={300}
          step={10}
          onValueChange={(value) =>
            onChange({ ...filters, maxDepth: firstSliderValue(value, 300) })
          }
          aria-label="Maximum earthquake depth"
        />
      </label>
    </div>
  );
}

type LayerControlsProps = {
  controlId: string;
  eventsVisible: boolean;
  faultsVisible: boolean;
  faultOpacity: number;
  eventCount: number;
  onEventsVisibleChange: (visible: boolean) => void;
  onFaultsVisibleChange: (visible: boolean) => void;
  onFaultOpacityChange: (opacity: number) => void;
};

export function LayerControls({
  controlId,
  eventsVisible,
  faultsVisible,
  faultOpacity,
  eventCount,
  onEventsVisibleChange,
  onFaultsVisibleChange,
  onFaultOpacityChange,
}: LayerControlsProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Layers3 className="size-4 text-primary" aria-hidden="true" />
        Layers
      </div>
      <div className="rounded-md border bg-card/55 p-3">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor={controlId} className="text-sm">
            AFAD earthquakes
          </label>
          <Switch
            id={controlId}
            checked={eventsVisible}
            onCheckedChange={onEventsVisibleChange}
            aria-label="Show AFAD earthquakes"
          />
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          {eventCount.toLocaleString()} events match the current map and
          filters.
        </p>
        <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="size-2.5 rounded-full bg-cyan-300" /> M &lt; 3
          <span className="size-2.5 rounded-full bg-yellow-400" /> M 3–3.9
          <span className="size-2.5 rounded-full bg-orange-400" /> M 4+
        </div>
      </div>
      <div className="rounded-md border bg-card/55 p-3">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor={`${controlId}-faults`} className="text-sm">
            GEM active faults
          </label>
          <Switch
            id={`${controlId}-faults`}
            checked={faultsVisible}
            onCheckedChange={onFaultsVisibleChange}
            aria-label="Show GEM active faults"
          />
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          1,165 mapped segments clipped to the Türkiye region. Colors indicate
          reported movement type.
        </p>
        <label className="mt-3 block">
          <span className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
            Fault opacity
            <output className="font-mono text-foreground">
              {Math.round(faultOpacity * 100)}%
            </output>
          </span>
          <Slider
            value={[faultOpacity]}
            min={0.2}
            max={1}
            step={0.05}
            disabled={!faultsVisible}
            onValueChange={(value) =>
              onFaultOpacityChange(firstSliderValue(value, 0.82))
            }
            aria-label="Fault layer opacity"
          />
        </label>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 bg-pink-400" /> Strike-slip
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 bg-cyan-400" /> Normal
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 bg-orange-400" /> Reverse
          </span>
        </div>
        <a
          href="https://github.com/GEMScienceTools/gem-global-active-faults"
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-block text-xs text-primary hover:underline"
        >
          © GEM Foundation contributors · CC BY-SA 4.0
        </a>
      </div>
    </div>
  );
}
