import { Link as RouterLink } from 'react-router';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

export default function NotFoundPage() {
  return (
    <Stack spacing={2} alignItems="flex-start">
      <Typography variant="h1">Page not found</Typography>
      <Typography color="text.secondary">The page you are looking for does not exist.</Typography>
      <Button variant="contained" component={RouterLink} to="/">
        Back to dashboard
      </Button>
    </Stack>
  );
}
