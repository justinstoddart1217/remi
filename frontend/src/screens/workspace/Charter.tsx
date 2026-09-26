import clsx from 'clsx';
import { useNavigate } from 'react-router';

import { useCreateCharterItem, useDeleteCharterItem, useDeleteProject, useUpdateCharterItem, useUpdateProject } from '../../api';
import type { ProjectOut } from '../../api';
import { InlineField, InlineList, TwoStepConfirmButton } from '../../components';
import { paths } from '../../app/screens';
import { CHARTER_LISTS, removeArmedLabel } from './copy';
import type { Guard } from './types';
import s from './Workspace.module.css';

/**
 * The Charter (Workspace.dc.html:141-166): Why now (multi-line: Enter is a newline, critique
 * CORRECTION :505-509), the four lists, and the two-step Remove project.
 */
export function Charter({ project: p, guard }: { project: ProjectOut; guard: Guard }) {
  const navigate = useNavigate();
  const update = useUpdateProject();
  const create = useCreateCharterItem();
  const edit = useUpdateCharterItem();
  const remove = useDeleteCharterItem();
  const del = useDeleteProject();

  return (
    <div className={s.charter}>
      <h2 className={s.colTitle}>Charter</h2>
      <div className={s.why}>
        <div className={clsx(s.label, s.whyLabel)} id={`why-${p.id}`}>
          Why now
        </div>
        <InlineField
          multi
          cpl={46}
          value={p.whyNow}
          placeholder="Why does this matter now, rather than later?"
          aria-labelledby={`why-${p.id}`}
          data-fk="why"
          className={s.whyField}
          onCommit={(whyNow) => guard(update.mutateAsync({ projectId: p.id, patch: { whyNow } }))}
        />
      </div>
      {CHARTER_LISTS.map((l) => (
        <InlineList
          key={l.list}
          label={l.label}
          items={p.charter[l.list].map((item) => ({ id: item.id, text: item.text }))}
          placeholder={l.placeholder}
          emptyText={l.empty}
          numbered={l.numbered}
          size={l.numbered ? 'l' : 'm'}
          muted={l.muted}
          onAdd={(text) => guard(create.mutateAsync({ projectId: p.id, list: l.list, text }))}
          onChange={(itemId, text) => guard(edit.mutateAsync({ itemId, patch: { text } }))}
          onRemove={(itemId) => guard(remove.mutateAsync({ itemId }))}
        />
      ))}
      <div className={s.remove}>
        <TwoStepConfirmButton
          label="Remove project"
          armedLabel={removeArmedLabel(p.name)}
          timeout={4000}
          onConfirm={() => {
            guard(del.mutateAsync({ projectId: p.id })).then(
              () => {
                void navigate(paths.projects());
              },
              () => undefined,
            );
          }}
        />
      </div>
    </div>
  );
}
