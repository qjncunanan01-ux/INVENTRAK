import { Box, 
         Chip,
         Paper,
         Table,
         TableBody,
         TableCell,
         TableContainer,
         TableHead,
         TableRow,
         TextField,
         Typography,
} from '@mui/material';

import SearchIcon from '@mui/icons-material/Search';
import { useEffect, useState } from 'react';
import { apiGet } from '../api';
import AdminLayout from './AdminLayout';

export default function AuditTrailPage({ user, onLogout }) {
    const [logs, setLogs] = useState([]);
    const [search, setSearch] = useState('');

    useEffect(() => {
        const loadAuditLogs = async () => {
            try {
                const response = await apiGet('api/audit-trail');

                const data = response.data || response;

            } catch (error) {
                console.error('Something went wrong while loading audit trail:', error);

            } finally {
                setLoading(false);
            }
        };
        loadAuditLogs();
    }, [])

    const filteredLogs = logs.filter((log) => {
        const q = search.toLowerCase();
        return (
            String(log.username || '').toLowerCase().includes(q) ||
            String(log.action || '').toLowerCase().includes(q) ||
            String(log.module || '').toLowerCase().includes(q) ||
            String(log.description || '').toLowerCase().includes(q)

        );
    })

    const getActionColor = (action) => {
        switch (action?.toLowerCase()) {
            case 'create':
                return 'success';

            case 'update':
                return 'primary';

            case 'delete':
                return 'error';
            
            case 'login':
                return 'primary';
            
            case 'logout':
                return 'default';

            default:
                return 'warning';
        }
    };

    return (
        <AdminLayout title="Audit Trail" onLogout={onLogout}>
            <Box sx={{ mb: 3}}>
                
            </Box>
        </AdminLayout>
    )
}   