import { useCallback, useState } from 'react';
import Alert from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';
import { NotificationContext } from './notificationContext';

/** Provides app-wide success/error snackbars via `useNotify()`. */
export default function NotificationProvider({ children }) {
  const [notification, setNotification] = useState(null);

  const notify = useCallback((message, severity = 'info') => {
    setNotification({ message, severity, key: Date.now() });
  }, []);

  const handleClose = (_event, reason) => {
    if (reason !== 'clickaway') setNotification(null);
  };

  return (
    <NotificationContext.Provider value={notify}>
      {children}
      <Snackbar
        key={notification?.key}
        open={Boolean(notification)}
        autoHideDuration={5000}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {notification ? (
          <Alert onClose={handleClose} severity={notification.severity} variant="filled" sx={{ width: '100%' }}>
            {notification.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </NotificationContext.Provider>
  );
}
