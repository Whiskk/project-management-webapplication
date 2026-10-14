import { useState } from 'react';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import { api } from '../../services/api';
import { useNotify } from '../feedback/notificationContext';

/**
 * Runs the budget monitor on demand (it also runs hourly where a schedule is
 * available). Changes it finds are recorded in the audit log as "Budget monitor".
 */
export default function BudgetCheckButton({ onDone }) {
  const notify = useNotify();
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    try {
      const result = await api.post('monitor', '/run');
      const over = result.newly_over_budget;
      const recovered = result.back_within_budget;
      if (over.length || recovered.length) {
        const parts = [];
        if (over.length) parts.push(`now over budget: ${over.join(', ')}`);
        if (recovered.length) parts.push(`back within budget: ${recovered.join(', ')}`);
        notify(`Budget check found changes - ${parts.join('; ')}`, over.length ? 'warning' : 'success');
      } else {
        notify(`Budget check complete: ${result.checked} project(s), no changes`, 'success');
      }
      onDone?.();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setRunning(false);
    }
  };

  return (
    <Button
      variant="outlined"
      onClick={run}
      disabled={running}
      startIcon={running ? <CircularProgress size={16} /> : <FactCheckIcon />}
    >
      {running ? 'Checking budgets…' : 'Run budget check now'}
    </Button>
  );
}
