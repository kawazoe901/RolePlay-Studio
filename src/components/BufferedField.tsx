import React, { useState, useRef, useEffect } from 'react';

export interface BufferedFieldProps {
  multiline?: boolean;
  type?: string;
  rows?: number;
  value: string;
  onCommit: (nextValue: string) => void;
  placeholder?: string;
  title?: string;
  className?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  onKeyDown?: React.KeyboardEventHandler<
    HTMLInputElement | HTMLTextAreaElement
  >;
  onEnter?: (currentValue: string) => void;
}

export const BufferedField: React.FC<BufferedFieldProps> = React.memo(
  ({
    multiline = false,
    type = 'text',
    rows = 3,
    value,
    onCommit,
    placeholder,
    title,
    className,
    disabled,
    autoFocus,
    onKeyDown,
    onEnter,
  }) => {
    const [draft, setDraft] = useState<string>(value);
    const isFocusedRef = useRef<boolean>(false);
    const latestDraftRef = useRef<string>(value);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const onCommitRef = useRef(onCommit);
    onCommitRef.current = onCommit;

    useEffect(() => {
      if (!isFocusedRef.current) {
        setDraft(value);
        latestDraftRef.current = value;
      }
    }, [value]);

    useEffect(() => {
      return () => {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
          onCommitRef.current(latestDraftRef.current);
        }
      };
    }, []);

    const flushNow = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (latestDraftRef.current !== value) {
        onCommitRef.current(latestDraftRef.current);
      }
    };

    const handleChange = (
      e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
    ) => {
      const next = e.target.value;
      setDraft(next);
      latestDraftRef.current = next;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        onCommitRef.current(latestDraftRef.current);
      }, 320);
    };

    const handleFocus = () => {
      isFocusedRef.current = true;
    };

    const handleBlur = () => {
      isFocusedRef.current = false;
      flushNow();
    };

    const handleKeyDownInternal = (
      e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>
    ) => {
      if (onEnter && e.key === 'Enter' && (!multiline || !e.shiftKey)) {
        e.preventDefault();
        flushNow();
        onEnter(latestDraftRef.current);
        return;
      }
      onKeyDown?.(e);
    };

    if (multiline) {
      return (
        <textarea
          rows={rows}
          value={draft}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDownInternal}
          placeholder={placeholder}
          title={title}
          disabled={disabled}
          autoFocus={autoFocus}
          className={className}
        />
      );
    }

    return (
      <input
        type={type}
        value={draft}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDownInternal}
        placeholder={placeholder}
        title={title}
        disabled={disabled}
        autoFocus={autoFocus}
        className={className}
      />
    );
  }
);
