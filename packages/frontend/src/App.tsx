import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Layout            from './components/Layout';
import { PipelineProvider } from './components/PipelineProvider';
import WorldView         from './pages/WorldView';
import Souls             from './pages/Souls';
import CharacterDetail   from './pages/CharacterDetail';
import NewCharacter      from './pages/NewCharacter';
import Headlines         from './pages/Headlines';
import Economy           from './pages/Economy';
import Rip               from './pages/Rip';
import RuleLibrary       from './pages/RuleLibrary';
import WorldDesigner     from './pages/WorldDesigner';
import People            from './pages/People';
import Groups            from './pages/Groups';
import Events            from './pages/Events';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5_000, retry: 1 },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <PipelineProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/"                    element={<WorldView />} />
              <Route path="/souls"               element={<Souls />} />
              <Route path="/console"             element={<WorldView />} />
              <Route path="/people"              element={<People />} />
              <Route path="/characters/new"      element={<NewCharacter />} />
              <Route path="/characters/:id"      element={<CharacterDetail />} />
              {/* legacy /character/:id alias (some links use singular) */}
              <Route path="/character/:id"       element={<CharacterDetail />} />
              <Route path="/chronicle"           element={<Headlines />} />
              <Route path="/headlines"           element={<Headlines />} />
              <Route path="/exchange"            element={<Economy />} />
              <Route path="/economy"             element={<Economy />} />
              <Route path="/fallen"              element={<Rip />} />
              <Route path="/rip"                 element={<Rip />} />
              <Route path="/world"               element={<WorldView />} />
              <Route path="/rules"               element={<RuleLibrary />} />
              <Route path="/worlds"              element={<WorldDesigner />} />
              <Route path="/groups"              element={<Groups />} />
              <Route path="/events"              element={<Events />} />
            </Route>
          </Routes>
        </PipelineProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
