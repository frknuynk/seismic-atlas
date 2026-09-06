'use client';

import { Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import type { CatalogEvent } from '@/shared/schemas';

function normalizeSearch(value: string) {
  return value
    .normalize('NFKD')
    .toLocaleLowerCase('tr-TR')
    .replaceAll('ı', 'i')
    .replace(/[\u0300-\u036f]/g, '');
}

function eventTime(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Istanbul',
  }).format(new Date(value));
}

type EventSearchProps = {
  events: CatalogEvent[];
  onSelectEvent: (eventId: string) => void;
};

export function EventSearch({ events, onSelectEvent }: EventSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const results = useMemo(() => {
    const normalizedQuery = normalizeSearch(query.trim());
    if (!normalizedQuery) return events.slice(0, 12);
    return events
      .filter((event) =>
        normalizeSearch(
          `${event.place ?? ''} ${event.sourceEventId} ${event.magnitude ?? ''}`,
        ).includes(normalizedQuery),
      )
      .slice(0, 20);
  }, [events, query]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        className="ml-auto w-9 justify-start px-0 sm:w-auto sm:min-w-48 sm:px-3 lg:max-w-sm lg:flex-1"
        aria-label="Search earthquakes in the current map view"
      >
        <Search className="size-4 text-muted-foreground" aria-hidden="true" />
        <span className="hidden flex-1 text-left font-normal text-muted-foreground sm:inline">
          Search current view
        </span>
        <kbd className="hidden rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground lg:inline">
          ⌘K
        </kbd>
      </Button>

      <CommandDialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) setQuery('');
        }}
        title="Search earthquakes"
        description="Search events currently loaded for this map view and filter range."
        className="sm:max-w-lg"
      >
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Place, magnitude, or AFAD event ID…"
          />
          <CommandList>
            <CommandEmpty>No matching earthquakes in this view.</CommandEmpty>
            <CommandGroup heading={query ? 'Matching events' : 'Latest events'}>
              {results.map((event) => (
                <CommandItem
                  key={event.id}
                  value={event.id}
                  onSelect={() => {
                    setOpen(false);
                    setQuery('');
                    onSelectEvent(event.id);
                  }}
                  className="items-start py-2.5"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-full border border-cyan-200/30 bg-cyan-300/10 font-mono text-xs font-semibold text-cyan-200">
                    {event.magnitude?.toFixed(1) ?? '—'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {event.place ?? 'Unknown location'}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {eventTime(event.originTime)} · AFAD {event.sourceEventId}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
