import { useNavigate } from 'react-router';

import { paths } from '../app/screens';
import { isReducedMotion } from '../lib/reducedMotion';
import { fadeOutThen, useStage } from '../lib/stage';

/**
 * Going Home: the stage fades to opacity 0 over 180ms ease-out, then navigates; under
 * reduced motion it navigates at once (Remi.dc.html goHome). Also used by the Textbook.
 */
export function useGoHome(): () => void {
  const navigate = useNavigate();
  const { ref } = useStage();
  return () => {
    fadeOutThen(
      ref?.current,
      () => {
        void navigate(paths.home());
      },
      { ms: 180, reduced: isReducedMotion() },
    );
  };
}
