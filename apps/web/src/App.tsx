import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import TopNav from "./components/TopNav";
import Courtroom from "./pages/Courtroom";
import Results from "./pages/Results";
import Replay from "./pages/Replay";
import Certificate from "./pages/Certificate";

export default function App() {
  return (
    <BrowserRouter>
      <div className="app-shell">
        <TopNav />
        <main className="page">
          <Routes>
            <Route path="/" element={<Navigate to="/courtroom" replace />} />
            <Route path="/courtroom" element={<Courtroom />} />
            <Route path="/results" element={<Results />} />
            <Route path="/replay" element={<Replay />} />
            <Route path="/certificate" element={<Certificate />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
