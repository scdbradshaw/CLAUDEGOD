import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Dashboard       from './pages/Dashboard';
import CharacterDetail from './pages/CharacterDetail';
import NewCharacter    from './pages/NewCharacter';
import Headlines       from './pages/Headlines';
import Economy         from './pages/Economy';
import Rip             from './pages/Rip';
import World           from './pages/World';
import RuleLibrary     from './pages/RuleLibrary';
import WorldDesigner   from './pages/WorldDesigner';
import People          from './pages/People';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5_000, retry: 1 },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/"                    element={<Dashboard />} />
          <Route path="/people"              element={<People />} />
          <Route path="/characters/new"      element={<NewCharacter />} />
          <Route path="/characters/:id"      element={<CharacterDetail />} />
          <Route path="/headlines"           element={<Headlines />} />
          <Route path="/economy"             element={<Economy />} />
          <Route path="/rip"                 element={<Rip />} />
          <Route path="/world"               element={<World />} />
          <Route path="/rules"               element={<RuleLibrary />} />
          <Route path="/worlds"              element={<WorldDesigner />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
