/**
 * Rail body — bottom slot of the right rail column, occupying everything
 * below the icon strip. Renders the active tab's component. Width and
 * resize handle are owned by the parent <RightRail>; the body is just a
 * fill element.
 *
 * adr: adr/right-rail.md
 */
import { useRightRail } from './RightRailContext';
import { useLayoutEffect, useState } from 'react';
import ReviewTab from './tabs/ReviewTab';
import { findTab } from './tabs';
import type { RightRailTabProps } from './types';

interface RailBodyProps extends RightRailTabProps { focusMode?: boolean }

export default function RailBody(props: RailBodyProps) {
  const { activeTab } = useRightRail();
  const active = findTab(activeTab);
  const [focusTarget, setFocusTarget] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setFocusTarget(props.focusMode ? document.getElementById('focus-review-controls') : null);
  }, [props.focusMode]);

  return (
    <div className="rail-body" role="tabpanel">
      {props.focusMode || activeTab === 'review'
        ? <ReviewTab {...props} focusReviewTarget={props.focusMode ? focusTarget : undefined} />
        : active ? <active.Component {...props} /> : null}
    </div>
  );
}
