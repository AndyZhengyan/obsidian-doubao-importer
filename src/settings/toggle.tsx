// Adapted from obsidian-getnote-importer src/settings/toggle.tsx
// Source commit: 4a5e2cc7c82a8f03b3169e76db1ebbe9a5b09c95 (MIT).
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

interface ToggleProps {
  value: boolean;
  onChange: (value: boolean) => void;
  ariaLabel: string;
  disabled?: boolean;
  title?: string;
}

/** Match Obsidian's switch markup while keeping updates inside Preact. */
export function Toggle({ value, onChange, ariaLabel, disabled, title }: ToggleProps) {
  const [currentValue, setCurrentValue] = useState(value);
  const currentValueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useLayoutEffect(() => { currentValueRef.current = value; setCurrentValue(value); }, [value]);
  const applyValue = (next: boolean) => {
    currentValueRef.current = next;
    setCurrentValue(next);
    onChangeRef.current(next);
  };
  return <div className={`checkbox-container${currentValue ? ' is-enabled' : ''}${disabled ? ' is-disabled' : ''}`}
    aria-disabled={disabled} title={title} onClick={event => {
      if (disabled) { event.preventDefault(); return; }
      if (!(event.target instanceof HTMLInputElement)) applyValue(!currentValueRef.current);
    }}>
    <input type="checkbox" aria-label={ariaLabel} checked={currentValue} disabled={disabled}
      onChange={event => { if (!disabled) applyValue(event.currentTarget.checked); }} />
  </div>;
}
