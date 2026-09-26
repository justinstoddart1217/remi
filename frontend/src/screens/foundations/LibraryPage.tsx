import { Eyebrow } from '../../components';
import s from './Foundations.module.css';
import { LibrarySection } from './LibrarySection';

/**
 * Remi · component library (dev-only, `/foundations/library`): every component in
 * src/components, live, with its states. It sits beside the Foundations page rather than on it,
 * so Foundations stays the prototype's page (Remi Foundations.dc.html) section for section.
 */
export function LibraryPage() {
  return (
    <div className={s.page} data-screen-label="Library">
      <header className={s.header}>
        <div>
          <Eyebrow>Remi · component library</Eyebrow>
          <h1 className={s.h1}>Every component, live</h1>
        </div>
        <p className={s.lede}>
          The production components with their states, beyond the prototype&rsquo;s Foundations page. Open{' '}
          <a href="/foundations">Foundations</a> for the tokens and the core specimens.
        </p>
      </header>
      <LibrarySection />
    </div>
  );
}

export default LibraryPage;
