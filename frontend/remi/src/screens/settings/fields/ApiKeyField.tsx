import { useState } from 'react';
import type { SyntheticEvent } from 'react';

import { Button, TwoStepConfirmButton } from '../../../components';
import m from './SettingsFields.module.css';

export interface ApiKeyFieldProps {
  id?: string;
  /** A key is configured (never the key itself). */
  keySet: boolean;
  /** 'env' keys come from the environment and cannot be forgotten here. */
  keySource: 'env' | 'keychain' | null;
  /** Stores the key; resolves once it is saved. */
  onSave: (apiKey: string) => Promise<unknown>;
  onForget: () => Promise<unknown>;
  busy: boolean;
}

/** The API's `AiKeyPut` limits. */
export const API_KEY_MIN = 8;
export const API_KEY_MAX = 400;

/**
 * The Anthropic key, write-only (decision 3): a password field and 'Save key' until one is
 * set, then only 'Key set' with Replace and Forget. The typed key lives in this component's
 * state until it is sent, and is cleared as soon as the save settles.
 */
export function ApiKeyField({ id, keySet, keySource, onSave, onForget, busy }: ApiKeyFieldProps) {
  const [draft, setDraft] = useState('');
  const [replacing, setReplacing] = useState(false);
  const trimmed = draft.trim();
  const ready = trimmed.length >= API_KEY_MIN && trimmed.length <= API_KEY_MAX;

  const submit = (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!ready || busy) return;
    const key = trimmed;
    setDraft('');
    onSave(key).then(
      () => {
        setReplacing(false);
      },
      () => undefined,
    );
  };

  if (keySet && !replacing) {
    return (
      <span className={m.keySet}>
        <span className={m.keyDot} aria-hidden="true" />
        <span className={m.keyLabel}>Key set</span>
        {keySource === 'env' ? (
          <span className={m.keyNote}>from the environment</span>
        ) : (
          <>
            <button
              type="button"
              className={m.textButton}
              onClick={() => {
                setReplacing(true);
              }}
            >
              Replace
            </button>
            <TwoStepConfirmButton
              label="Forget key"
              armedLabel="Click again to forget the key"
              onConfirm={() => {
                void onForget().catch(() => undefined);
              }}
            />
          </>
        )}
      </span>
    );
  }

  return (
    <form className={m.keyForm} onSubmit={submit} autoComplete="off">
      <input
        id={id}
        type="password"
        className={m.keyInput}
        value={draft}
        placeholder="sk-ant-…"
        spellCheck={false}
        autoComplete="off"
        aria-label="Anthropic API key"
        maxLength={API_KEY_MAX}
        onChange={(e) => {
          setDraft(e.currentTarget.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && replacing) {
            e.stopPropagation();
            setDraft('');
            setReplacing(false);
          }
        }}
      />
      <Button type="submit" variant="outline" size="m" className={m.keySave} disabled={!ready || busy}>
        {busy ? 'Saving…' : 'Save key'}
      </Button>
      {replacing && (
        <button
          type="button"
          className={m.textButton}
          onClick={() => {
            setDraft('');
            setReplacing(false);
          }}
        >
          Cancel
        </button>
      )}
    </form>
  );
}
