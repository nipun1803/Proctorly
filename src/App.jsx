import './App.css';
import useExamSession from './hooks/useExamSession';
import BlockedAppsScreen from './screens/BlockedAppsScreen';
import ResultsScreen from './screens/ResultsScreen';
import ExamScreen from './screens/ExamScreen';
import SetupScreen from './screens/SetupScreen';

export default function App() {
  const exam = useExamSession();

  // Keep the original screen priority: blocked apps, results, exam, setup.
  if (exam.showAppsPanel && exam.blockedAppsList.length > 0) {
    return <BlockedAppsScreen {...exam} />;
  }
  if (exam.examState === 'SUBMITTED' || exam.examState === 'EXPIRED') {
    return <ResultsScreen {...exam} />;
  }
  if (exam.examState === 'ACTIVE') {
    return <ExamScreen {...exam} />;
  }
  return <SetupScreen {...exam} />;
}
