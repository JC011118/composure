import { useEffect, useMemo } from 'react';
import { Hud } from './components/Hud';
import { SessionController } from './runtime/controller';
import { ControllerContext, useController, useEngineSnapshot, useStore } from './runtime/hooks';
import { BaselineScreen } from './screens/BaselineScreen';
import { ConsentScreen } from './screens/ConsentScreen';
import { DebriefView, SessionsScreen } from './screens/DebriefScreen';
import { GateScreen } from './screens/GateScreen';
import { InterviewScreen } from './screens/InterviewScreen';

function SessionView() {
  const controller = useController();
  const engine = useStore(controller.engineStore);
  const snap = useEngineSnapshot(engine);
  const app = useStore(controller.app);
  if (!engine || !snap) return null;
  const banner = app.sourceError ? (
    <div className="banner warn" style={{ margin: '16px 32px 0' }}>
      Signal source: {app.sourceError}
    </div>
  ) : null;
  let body: React.ReactNode;
  switch (snap.phase) {
    case 'signalCheck':
    case 'baselineSeated':
    case 'baselineTalking':
      body = <BaselineScreen engine={engine} snap={snap} />;
      break;
    case 'asking':
    case 'listening':
      body = <InterviewScreen engine={engine} snap={snap} />;
      break;
    case 'gate':
      body = <GateScreen engine={engine} snap={snap} />;
      break;
    case 'debrief': {
      const record = controller.currentRecord();
      body = record ? <DebriefView record={record} live /> : null;
      break;
    }
    default:
      body = null;
  }
  return (
    <>
      {banner}
      {body}
    </>
  );
}

function Shell() {
  const controller = useController();
  const app = useStore(controller.app);
  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Composure</span>
        <span>{app.boot ? `${app.boot.mode} mode` : ''}</span>
      </header>
      {app.screen === 'consent' && <ConsentScreen />}
      {app.screen === 'session' && <SessionView />}
      {app.screen === 'sessions' && <SessionsScreen />}
      {app.screen === 'saved' && app.savedRecord && <DebriefView record={app.savedRecord} live={false} />}
      <Hud />
    </div>
  );
}

export function App() {
  const controller = useMemo(() => new SessionController(), []);
  useEffect(() => {
    void controller.init();
  }, [controller]);
  return (
    <ControllerContext.Provider value={controller}>
      <Shell />
    </ControllerContext.Provider>
  );
}
