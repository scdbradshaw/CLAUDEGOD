// Application shell + router. Phase 11a baseline; pages 11b–11g will fill in.

import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { Layout } from './components/Layout';
import { IndexPage } from './pages/Index';
import { WorldSetup } from './pages/WorldSetup';
import { WorldMap } from './pages/WorldMap';
import { CityDetail } from './pages/CityDetail';
import { PersonDetail } from './pages/PersonDetail';
import { GroupDetail } from './pages/GroupDetail';
import { Religions } from './pages/Religions';
import { Factions } from './pages/Factions';
import { People } from './pages/People';
import { GodMode } from './pages/GodMode';
import { Market } from './pages/Market';

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<IndexPage />} />
            <Route path="setup" element={<WorldSetup />} />
            <Route path="world/:worldId" element={<WorldMap />} />
            <Route path="world/:worldId/city/:cityId" element={<CityDetail />} />
            <Route path="world/:worldId/person/:personId" element={<PersonDetail />} />
            <Route path="world/:worldId/group/:groupId" element={<GroupDetail />} />
            <Route path="world/:worldId/religions" element={<Religions />} />
            <Route path="world/:worldId/factions" element={<Factions />} />
            <Route path="world/:worldId/people" element={<People />} />
            <Route path="world/:worldId/market" element={<Market />} />
            <Route path="world/:worldId/god" element={<GodMode />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
