import { useId, useState } from 'react';

import type { RoutineChecklistItemOut } from '../../api';
import { Icon, InlineList } from '../../components';
import { checklistLabel, COPY } from './model';
import type { RoutineActions } from './RoutineRow';
import s from './Routines.module.css';

export interface RoutineChecklistProps {
  routineId: string;
  /** '3rd business day, monthly · 12 funds'. */
  ruleLine: string;
  items: readonly RoutineChecklistItemOut[];
  actions: Pick<RoutineActions, 'addItem' | 'renameItem' | 'removeItem'>;
}

/**
 * The rule line, then the routine's checklist (decision 10: the items each run works through,
 * such as the 12 funds Today ticks off). It stays out of the way: a small chevron ends the rule
 * line, its 'Checklist · 12' label shows while the row is hovered or the list is open, and the
 * list opens below in the Charter list pattern (components/InlineList).
 */
export function RoutineChecklist({ routineId, ruleLine, items, actions }: RoutineChecklistProps) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <>
      <div className={s.ruleLine}>
        {ruleLine}
        <button
          type="button"
          className={s.checklistToggle}
          data-open={open ? '' : undefined}
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => {
            setOpen((o) => !o);
          }}
        >
          <Icon name="chevron_right" className={s.checklistChevron} />
          <span className={s.checklistLabel}>{checklistLabel(items.length)}</span>
        </button>
      </div>
      <div id={listId} hidden={!open}>
        {open && (
          <InlineList
            label={COPY.checklist}
            className={s.checklist}
            items={items.map((it) => ({ id: it.id, text: it.label }))}
            placeholder={COPY.checklistPlaceholder}
            emptyText={COPY.checklistEmpty}
            onAdd={(label) => actions.addItem(routineId, label)}
            onChange={(id, label) => actions.renameItem(id, label)}
            onRemove={(id) => actions.removeItem(id)}
          />
        )}
      </div>
    </>
  );
}
