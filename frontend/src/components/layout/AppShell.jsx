import { Suspense, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useMediaQuery } from 'react-responsive';
import AppBar from '@mui/material/AppBar';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import AssignmentTurnedInIcon from '@mui/icons-material/AssignmentTurnedIn';
import DashboardIcon from '@mui/icons-material/Dashboard';
import FolderIcon from '@mui/icons-material/Folder';
import HistoryIcon from '@mui/icons-material/History';
import InboxIcon from '@mui/icons-material/Inbox';
import MenuIcon from '@mui/icons-material/Menu';
import PeopleIcon from '@mui/icons-material/People';
import { useAuth } from '../../auth/authContext';
import { can } from '../../auth/permissions';
import { useApprovalCount } from '../../services/approvalCount';
import { useRequestCount } from '../../services/requestCount';
import BrandMark from './BrandMark';
import UserMenu from './UserMenu';

const DRAWER_WIDTH = 240;

// Navigation entries. Items with a `permission` are only shown to roles that have it.
const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: <DashboardIcon /> },
  { to: '/projects', label: 'Projects', icon: <FolderIcon /> },
  { to: '/approvals', label: 'Approvals', icon: <AssignmentTurnedInIcon />, permission: 'approvals.review', badge: 'approvals' },
  { to: '/requests', label: 'Requests', icon: <InboxIcon />, permission: 'requests.view', badge: 'requests' },
  { to: '/users', label: 'Users', icon: <PeopleIcon />, permission: 'users.view' },
  { to: '/audit', label: 'Audit log', icon: <HistoryIcon />, permission: 'audit.view' },
  { to: '/profile', label: 'My profile', icon: <AccountCircleIcon /> },
];

/** Responsive app layout: permanent sidebar on desktop, slide-out drawer on mobile. */
export default function AppShell() {
  const { user } = useAuth();
  const location = useLocation();
  // Refreshed on every navigation so the badge stays current without polling.
  const approvalCount = useApprovalCount(can(user, 'approvals.review'), location.key);
  const requestCount = useRequestCount(can(user, 'requests.review'), location.key);
  const badges = { approvals: approvalCount, requests: requestCount };
  const isDesktop = useMediaQuery({ minWidth: 900 });
  const [mobileOpen, setMobileOpen] = useState(false);
  const visibleItems = NAV_ITEMS.filter((item) => !item.permission || can(user, item.permission));

  const navigation = (
    <Box component="nav" aria-label="Main navigation">
      <Toolbar />
      <List sx={{ px: 1.5, py: 2, display: 'grid', gap: 0.5 }}>
        {visibleItems.map((item) => (
          <ListItem key={item.to} disablePadding>
            <ListItemButton
              component={NavLink}
              to={item.to}
              end={item.to === '/'}
              onClick={() => setMobileOpen(false)}
              sx={{
                py: 1,
                color: 'text.secondary',
                '& .MuiListItemText-primary': { fontSize: '0.9rem', fontWeight: 500 },
                '&:hover': { color: 'text.primary' },
                '&.active': {
                  bgcolor: 'action.selected',
                  color: 'primary.light',
                  '& .MuiListItemText-primary': { fontWeight: 600 },
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: 40, color: 'inherit' }}>
                {item.badge && badges[item.badge] > 0 ? (
                  <Badge badgeContent={badges[item.badge]} color="error" aria-label={`${badges[item.badge]} awaiting ${item.badge === 'approvals' ? 'approval' : 'review'}`}>
                    {item.icon}
                  </Badge>
                ) : item.icon}
              </ListItemIcon>
              <ListItemText primary={item.label} />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}>
        <Toolbar>
          {!isDesktop && (
            <IconButton color="inherit" edge="start" aria-label="Open navigation" onClick={() => setMobileOpen(true)} sx={{ mr: 1 }}>
              <MenuIcon />
            </IconButton>
          )}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexGrow: 1, minWidth: 0 }}>
            <BrandMark />
            <Typography variant="h6" component="span" noWrap>
              Project Hub
            </Typography>
          </Box>
          <UserMenu compact={!isDesktop} />
        </Toolbar>
      </AppBar>

      <Drawer
        variant={isDesktop ? 'permanent' : 'temporary'}
        open={isDesktop || mobileOpen}
        onClose={() => setMobileOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{ width: DRAWER_WIDTH, flexShrink: 0, '& .MuiDrawer-paper': { width: DRAWER_WIDTH } }}
      >
        {navigation}
      </Drawer>

      <Box component="main" sx={{ flexGrow: 1, minWidth: 0, p: { xs: 2, md: 4 } }}>
        <Toolbar />
        <Box sx={{ maxWidth: 1400, mx: 'auto' }}>
          {/* Lazy-loaded pages: only the content area waits, the navigation stays. */}
          <Suspense
            fallback={(
              <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
                <CircularProgress aria-label="Loading page" />
              </Box>
            )}
          >
            <Outlet />
          </Suspense>
        </Box>
      </Box>
    </Box>
  );
}
