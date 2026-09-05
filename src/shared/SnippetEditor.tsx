/**
 * The one and only snippet form: a label and a value. No third field.
 * Values are always plaintext. The secret warning informs; it never gates Save.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { MAX_LABEL_CHARS, MAX_SNIPPET_CHARS, type Snippet } from '../lib/schema';
import { detectSecret, SECRET_WARNING_TEXT } from '../lib/guards';

export interface SnippetEditorProps {
  initial?: Partial<Snippet>;
  warnOnSecrets: boolean;
  onSave: (data: { label: string; value: string }) => void;
  onCancel: () => void;
  onDelete?: () => void;
  autoFocusValue?: boolean;
  compact?: boolean;
}

export function SnippetEditor({ initial, warnOnSecrets, onSave, onCancel, onDelete, autoFocusValue, compact }: SnippetEditorProps) {
  const [label, setLabel] = useState(initial?.label ?? '');
  const [value, setValue] = useState(initial?.value ?? '');
  const [hit, setHit] = useState<ReturnType<typeof detectSecret>>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = useRef<HTMLTextAreaElement>(null);

  // Debounced (~150ms) local-only detection on input/paste.
  useEffect(() => {
    if (!warnOnSecrets) {
      setHit(null);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setHit(detectSecret(value)), 150);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, warnOnSecrets]);

  useEffect(() => {
    if (autoFocusValue) valueRef.current?.focus();
  }, [autoFocusValue]);

  const valueOver = value.length > MAX_SNIPPET_CHARS;
  const labelOver = label.length > MAX_LABEL_CHARS;
  const canSave = value.trim().length > 0 && !valueOver && !labelOver;
  const valueHint = useMemo(() => `${value.length} / ${MAX_SNIPPET_CHARS}`, [value.length]);

  const submit = (e?: Event) => {
    e?.preventDefault();
    if (!canSave) return;
    onSave({ label: label.trim().slice(0, MAX_LABEL_CHARS), value });
  };

  return (
    <form
      class="snippet-editor"
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          submit();
        }
      }}
    >
      <label class="field">
        <span>
          Label <span class="hint">(optional)</span>
          <span class={`counter ${labelOver ? 'over' : ''}`}>{label.length} / {MAX_LABEL_CHARS}</span>
        </span>
        <input
          class={`input ${labelOver ? 'invalid' : ''}`}
          value={label}
          maxLength={MAX_LABEL_CHARS + 20}
          placeholder="e.g. List guest users"
          onInput={(e) => setLabel((e.target as HTMLInputElement).value)}
          autoFocus={!autoFocusValue}
        />
      </label>
      <label class="field">
        <span>
          Value <span class={`counter ${valueOver ? 'over' : ''}`}>{valueHint}</span>
        </span>
        <textarea
          ref={valueRef}
          class={`input ${hit || valueOver ? 'invalid' : ''}`}
          value={value}
          rows={compact ? 3 : 6}
          spellcheck={false}
          placeholder="Command, query, id or URL — stored exactly as typed, in plaintext"
          onInput={(e) => setValue((e.target as HTMLTextAreaElement).value)}
        />
        {hit ? <div class="warn-line">{SECRET_WARNING_TEXT}</div> : null}
        {valueOver ? <div class="warn-line">Values are limited to {MAX_SNIPPET_CHARS} characters. Long blocks belong in a script file, not a snippet.</div> : null}
      </label>
      <div class="row-actions">
        {onDelete ? (
          <button type="button" class="btn btn-danger" onClick={onDelete} style={{ marginRight: 'auto' }}>
            Delete
          </button>
        ) : null}
        <button type="button" class="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" class="btn btn-primary" disabled={!canSave} title="Ctrl+Enter">
          Save
        </button>
      </div>
    </form>
  );
}
