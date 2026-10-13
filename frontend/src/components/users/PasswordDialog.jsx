import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Typography from '@mui/material/Typography';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';

/** Shows a generated one-time password. It is never retrievable again after closing. */
export default function PasswordDialog({ credentials, onClose }) {
  const [copied, setCopied] = useState(false);
  if (!credentials) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(credentials.password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{credentials.title}</DialogTitle>
      <DialogContent>
        <Typography gutterBottom>
          Share these sign-in details with <strong>{credentials.name}</strong>:
        </Typography>
        <Box sx={{ my: 2, p: 2, bgcolor: 'grey.100', borderRadius: 1, fontFamily: 'monospace', fontSize: 18 }}>
          <div>Employee ID: {credentials.employeeId}</div>
          <div>
            Password: <span data-testid="temporary-password">{credentials.password}</span>
          </div>
        </Box>
        <Alert severity="warning">This password will not be shown again.</Alert>
      </DialogContent>
      <DialogActions>
        <Button startIcon={<ContentCopyIcon />} onClick={handleCopy}>
          {copied ? 'Copied' : 'Copy password'}
        </Button>
        <Button variant="contained" onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}
