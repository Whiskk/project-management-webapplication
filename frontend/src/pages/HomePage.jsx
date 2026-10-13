import { useCallback } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import useApiResource from '../hooks/useApiResource';
import { api } from '../services/api';

/** Landing page. Shows backend/database connectivity until role dashboards land. */
export default function HomePage() {
  const fetchHealth = useCallback((signal) => api.get('health', '', { signal }), []);
  const health = useApiResource(fetchHealth);

  return (
    <Stack spacing={3}>
      <Typography variant="h1">Dashboard</Typography>
      <Card sx={{ maxWidth: 480 }}>
        <CardContent>
          <Typography variant="h3" component="h2" gutterBottom>
            System status
          </Typography>
          {health.status === 'loading' && <Skeleton variant="rounded" height={32} aria-label="Loading system status" />}
          {health.status === 'success' && (
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Chip color="success" label="API online" />
              <Chip color="success" label="Database connected" />
              <Chip variant="outlined" label={`Schema v${health.data.schema_version}`} />
            </Stack>
          )}
          {health.status === 'error' && (
            <Alert
              severity="error"
              action={<Button color="inherit" size="small" onClick={health.reload}>Retry</Button>}
            >
              {health.error.message}
            </Alert>
          )}
        </CardContent>
      </Card>
    </Stack>
  );
}
