import { useState } from 'react';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Chip from '@mui/material/Chip';
import ListItemIcon from '@mui/material/ListItemIcon';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import LogoutIcon from '@mui/icons-material/Logout';
import { useAuth } from '../../auth/authContext';
import { ROLE_LABELS } from '../../auth/permissions';

/** App bar account button: shows the signed-in user and a sign-out action. */
export default function UserMenu({ compact = false }) {
  const { user, logout } = useAuth();
  const [anchor, setAnchor] = useState(null);
  if (!user) return null;

  const fullName = `${user.first_name} ${user.last_name}`;
  const initials = `${user.first_name[0] ?? ''}${user.last_name[0] ?? ''}`.toUpperCase();

  return (
    <>
      <ButtonBase
        onClick={(event) => setAnchor(event.currentTarget)}
        aria-label={`Account menu for ${fullName}`}
        aria-haspopup="menu"
        sx={{ borderRadius: 2, px: 1, py: 0.5, gap: 1.5, color: 'inherit' }}
      >
        {!compact && (
          <Box sx={{ textAlign: 'right' }}>
            <Typography variant="body2" fontWeight={600} lineHeight={1.2}>
              {fullName}
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.8 }}>
              {ROLE_LABELS[user.role]} · {user.employee_id}
            </Typography>
          </Box>
        )}
        <Avatar sx={{ width: 34, height: 34, bgcolor: 'secondary.main', color: 'secondary.contrastText', fontSize: 14, fontWeight: 600 }}>{initials}</Avatar>
      </ButtonBase>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box sx={{ px: 2, py: 1 }}>
          <Typography fontWeight={600}>{fullName}</Typography>
          <Typography variant="body2" color="text.secondary">{user.email}</Typography>
          <Chip size="small" label={ROLE_LABELS[user.role]} sx={{ mt: 1 }} />
        </Box>
        <MenuItem
          onClick={() => {
            setAnchor(null);
            logout();
          }}
        >
          <ListItemIcon>
            <LogoutIcon fontSize="small" />
          </ListItemIcon>
          Sign out
        </MenuItem>
      </Menu>
    </>
  );
}
