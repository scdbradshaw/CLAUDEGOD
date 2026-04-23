// ============================================================
// Layout — wraps every page with the persistent NavBar.
// Phase 6: prepends the PipelineHeartbeat (sticky top bar) so
// year-pipeline progress is visible from any page.
// ============================================================

import { Outlet } from 'react-router-dom';
import NavBar from './NavBar';
import PipelineHeartbeat from './PipelineHeartbeat';

export default function Layout() {
  return (
    <>
      <PipelineHeartbeat />
      <NavBar />
      <Outlet />
    </>
  );
}
