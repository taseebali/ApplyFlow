import { useEffect, useMemo, useRef, useState } from 'react';
import { MagnifyingGlassIcon } from '@phosphor-icons/react';
import { filterCommands, groupCommands, nextIndex, type Command } from '@/lib/commands';

/**
 * One entry point to everything, reachable from the keyboard.
 *
 * A menu tree makes you know where a thing lives before you can reach it; this
 * only asks what it is called. The same list is the search, the navigation and
 * the shortcut reference, so there is one place to look rather than three.
 */
export function CommandPalette({
  commands,
  open,
  onClose,
}: {
  commands: Command[];
  open: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => filterCommands(commands, query), [commands, query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelected(0);
    inputRef.current?.focus();
  }, [open]);

  // Typing changes what is on screen, so the old position means nothing.
  useEffect(() => setSelected(0), [query]);

  // Keeps the selected row in view when arrowing past the fold.
  useEffect(() => {
    listRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  if (!open) return null;

  const run = (command: Command) => {
    if (command.disabledReason) return;
    onClose();
    command.run();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setSelected((current) => nextIndex(current, matches.length, event.key === 'ArrowDown' ? 1 : -1));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const command = matches[selected];
      if (command) run(command);
    }
  };

  // Flat order for the keyboard, grouped order for the eye. They have to agree,
  // so the grouped render looks its row up in the flat list rather than
  // counting separately.
  const flat = groupCommands(matches).flatMap(([, items]) => items);

  return (
    <div className="palette-scrim" role="presentation" onClick={onClose}>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Commands"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="palette-input">
          <MagnifyingGlassIcon size={17} weight="light" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            placeholder="Search fields, run a command"
            aria-label="Search fields, run a command"
            aria-controls="palette-list"
            aria-activedescendant={flat[selected] ? `cmd-${flat[selected].id}` : undefined}
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd>Esc</kbd>
        </div>

        <div className="palette-list" id="palette-list" role="listbox" ref={listRef}>
          {flat.length === 0 ? (
            <p className="hint palette-empty">Nothing matches that.</p>
          ) : (
            groupCommands(matches).map(([group, items]) => (
              <div key={group}>
                <p className="group-label">{group}</p>
                {items.map((command) => {
                  const index = flat.indexOf(command);
                  return (
                    <button
                      key={command.id}
                      id={`cmd-${command.id}`}
                      type="button"
                      role="option"
                      aria-selected={index === selected}
                      className="palette-row"
                      disabled={Boolean(command.disabledReason)}
                      title={command.disabledReason}
                      onMouseMove={() => setSelected(index)}
                      onClick={() => run(command)}
                    >
                      <span className="palette-label">{command.label}</span>
                      {command.keys && <kbd>{command.keys}</kbd>}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <p className="palette-foot mono">
          <span>↑↓ move</span>
          <span>⏎ run</span>
          <span>Esc close</span>
        </p>
      </div>
    </div>
  );
}

/** Opens on the platform's own modifier, so the shortcut reads right on both. */
export function useCommandKey(onOpen: () => void): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onOpen();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onOpen]);
}
