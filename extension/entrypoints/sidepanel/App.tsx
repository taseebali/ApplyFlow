import { useRef } from 'react';
import { DocumentsSection, NotionSettingsSection, ProfileForm } from '@/components/ProfileForm';
import { useProfileEditor } from '@/components/useProfileEditor';
import { DailyView } from '@/components/DailyView';
import './App.css';

function App() {
  const { profile, setProfile, loaded, saveState, save, exportJson, importFile, importError, clearImportError } =
    useProfileEditor();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImportClick = () => {
    clearImportError();
    fileInputRef.current?.click();
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) await importFile(file);
  };

  if (!loaded) return <div className="loading-state">Loading your profile…</div>;

  return (
    <div className="panel">
      <header>
        <h1>Job Application Autofiller</h1>
      </header>

      <DailyView onOpenSetup={() => {}} />

      <header className="profile-header">
        <h2>Your profile</h2>
        <div className="actions">
          <button type="button" className="btn" onClick={exportJson}>
            Export JSON
          </button>
          <button type="button" className="btn" onClick={handleImportClick}>
            Import JSON
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            style={{ display: 'none' }}
            onChange={handleImportFile}
          />
          <button type="button" className="btn btn-primary" onClick={save}>
            {saveState === 'saved' ? 'Saved' : 'Save'}
          </button>
        </div>
      </header>
      {importError && <p className="error">{importError}</p>}

      <ProfileForm profile={profile} onChange={setProfile} />
      <DocumentsSection />
      <NotionSettingsSection />
    </div>
  );
}

export default App;
