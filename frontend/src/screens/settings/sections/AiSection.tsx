import clsx from 'clsx';
import { useState } from 'react';

import { useAiStatus, useDeleteAiKey, usePutAiKey, useUpdateSettings } from '../../../api';
import type { SettingsOut } from '../../../api';
import { Checkbox, InlineField } from '../../../components';
import { ProviderField, ProviderStatus } from '../../setup/fields/ChoiceFields';
import f from '../../setup/fields/Fields.module.css';
import { FieldError, FieldRow, SaveNote, Section } from '../../setup/frame/Section';
import { useSaveFeedback } from '../../setup/frame/useSaveFeedback';
import { PROVIDER_NOTE } from '../../setup/model';
import type { AiProvider } from '../../setup/model';
import { ApiKeyField } from '../fields/ApiKeyField';
import m from '../fields/SettingsFields.module.css';
import { aiStatusLine } from '../model';

export interface AiSectionProps {
  settings: SettingsOut;
  index: number;
}

/**
 * 04 Tell Remi: who reads a check-in (None by default), the model, the write-only Anthropic
 * key, the loopback Ollama address and whether recent notes go along.
 */
export function AiSection({ settings, index }: AiSectionProps) {
  const feedback = useSaveFeedback();
  const update = useUpdateSettings();
  const status = useAiStatus();
  const putKey = usePutAiKey();
  const deleteKey = useDeleteAiKey();
  const [pendingProvider, setPendingProvider] = useState<AiProvider | null>(null);
  const [pendingNotes, setPendingNotes] = useState<boolean | null>(null);
  const provider = pendingProvider ?? settings.aiProvider;

  const patch = (body: Parameters<typeof update.mutateAsync>[0], field?: string) =>
    feedback.track(update.mutateAsync(body), null, field);

  const chooseProvider = (next: AiProvider) => {
    if (next === settings.aiProvider) {
      setPendingProvider(null);
      return;
    }
    setPendingProvider(next);
    const done = () => {
      setPendingProvider((cur) => (cur === next ? null : cur));
    };
    patch({ aiProvider: next }).then(done, done);
  };

  const line = aiStatusLine(status.data, provider);
  const keySet = status.data?.keySet ?? settings.aiKeyConfigured;
  const showKey = provider === 'anthropic' || keySet;

  return (
    <Section
      id="ai"
      number="04"
      title="Tell Remi"
      note="How your check-ins are read."
      index={index}
      status={<SaveNote state={feedback.state} />}
    >
      <FieldRow label="Provider" note="None is the default. Remi always shows you the changes before anything moves.">
        <ProviderField value={provider} onChange={chooseProvider} />
        <span className={f.providerNote}>{PROVIDER_NOTE[provider]}</span>
        {line && <ProviderStatus tone={line.tone}>{line.text}</ProviderStatus>}
      </FieldRow>
      {provider !== 'none' && (
        <FieldRow label="Model" note="Leave it blank for the provider's default." htmlFor="settings-model">
          <InlineField
            id="settings-model"
            value={settings.aiModel ?? ''}
            placeholder={status.data?.provider === provider && status.data.model ? status.data.model : 'Default'}
            className={m.text}
            aria-label="Model"
            onCommit={(v) => {
              const model = v.trim() || null;
              return model === (settings.aiModel ?? null) ? undefined : patch({ aiModel: model }, 'model');
            }}
          />
          <FieldError state={feedback.state} field="model" />
        </FieldRow>
      )}
      {showKey && (
        <FieldRow
          label="Anthropic key"
          note="Kept in this computer's secure key store. Remi never shows it again."
          htmlFor="settings-ai-key"
        >
          <ApiKeyField
            id="settings-ai-key"
            keySet={keySet}
            keySource={status.data?.keySource ?? null}
            busy={putKey.isPending || deleteKey.isPending}
            onSave={(apiKey) =>
              feedback.track(putKey.mutateAsync({ apiKey }), () => 'key stored', 'key').finally(() => {
                putKey.reset();
              })
            }
            onForget={() => feedback.track(deleteKey.mutateAsync(), () => 'key forgotten', 'key')}
          />
          <FieldError state={feedback.state} field="key" />
        </FieldRow>
      )}
      {provider === 'ollama' && (
        <FieldRow label="Ollama address" note="On this computer only. Remi refuses any other address." htmlFor="settings-ollama">
          <InlineField
            id="settings-ollama"
            value={settings.ollamaBaseUrl}
            required
            className={clsx(m.text, m.textMono)}
            aria-label="Ollama address"
            onCommit={(v) => {
              const url = v.trim();
              return url === settings.ollamaBaseUrl ? undefined : patch({ ollamaBaseUrl: url }, 'ollama');
            }}
          />
          <FieldError state={feedback.state} field="ollama" />
        </FieldRow>
      )}
      <FieldRow label="Recent notes" note="Only sent when a provider is on. Notes never change the plan by themselves.">
        <Checkbox
          checked={pendingNotes ?? settings.aiSendRecentNotes}
          size={16}
          strike="none"
          className={m.notesToggle}
          onChange={(next) => {
            setPendingNotes(next);
            const done = () => {
              setPendingNotes((cur) => (cur === next ? null : cur));
            };
            patch({ aiSendRecentNotes: next }).then(done, done);
          }}
        >
          Send my notes from the last five business days with each check-in
        </Checkbox>
      </FieldRow>
    </Section>
  );
}
