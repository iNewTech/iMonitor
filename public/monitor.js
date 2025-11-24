document.addEventListener('DOMContentLoaded', () => {
    const startButton = document.getElementById('start-monitoring');
    const stopButton = document.getElementById('stop-monitoring');
    const disconnectButton = document.getElementById('disconnect');
    const refreshInterval = document.getElementById('refresh-interval');
    const systemStats = document.getElementById('system-stats');

    let monitoring = false;

    startButton?.addEventListener('click', () => {
        if (!monitoring && refreshInterval) {
            const interval = parseInt(refreshInterval.value);
            window.electronAPI.startMonitoring(interval);
            monitoring = true;
            startButton.textContent = 'Monitoring...';
            startButton.disabled = true;
            stopButton?.removeAttribute('disabled');
        }
    });

    stopButton?.addEventListener('click', () => {
        if (monitoring) {
            window.electronAPI.stopMonitoring();
            monitoring = false;
            startButton.textContent = 'Start Monitoring';
            startButton.disabled = false;
            stopButton.disabled = true;
        }
    });

    refreshInterval?.addEventListener('change', (event) => {
        if (monitoring) {
            const interval = parseInt(event.target.value);
            window.electronAPI.startMonitoring(interval);
        }
    });

    disconnectButton?.addEventListener('click', async () => {
        try {
            const result = await window.electronAPI.disconnect();
            if (result.success) {
                // The main process will automatically navigate to the connection page
                console.log('Disconnected successfully');
            } else {
                console.error('Disconnect failed:', result.error);
            }
        } catch (error) {
            console.error('Error during disconnect:', error);
        }
    });

    // Check connection state on page load
    // async function checkConnectionState() {
    //     try {
    //         const state = await window.electronAPI.getConnectionState();
    //         if (!state.isConnected) {
    //             // If not connected, go back to connection page
    //             await window.electronAPI.navigateToConnection();
    //         }
    //     } catch (error) {
    //         console.error('Error checking connection state:', error);
    //         await window.electronAPI.navigateToConnection();
    //     }
    // }
    // checkConnectionState();

    // Listen for status updates
    window.electronAPI.onStatusUpdate((data) => {
        if (systemStats) {
            const tbody = systemStats.querySelector('tbody');
            if (!data.data || !data.data.length) {
                tbody.innerHTML = `
                    <tr class="table-placeholder">
                        <td colspan="6" class="text-center py-4 text-muted">
                            <i class="bi bi-inbox fs-2 d-block mb-2"></i>
                            No active jobs to display
                        </td>
                    </tr>`;
                return;
            }

            tbody.innerHTML = data.data.map(job => `
                <tr>
                    <td>${job.SUBSYSTEM_JOB || ''}</td>
                    <td>${job.CURRENT_USER || ''}</td>
                    <td>${job.TYPE || ''}</td>
                    <td>${typeof job.CPU === 'number' ? job.CPU.toFixed(2) : '0.00'}</td>
                    <td>${job.FUNCTION_NAME || ''}</td>
                    <td>
                        <span class="badge ${getStatusBadgeClass(job.STATUS)}">
                            ${job.STATUS || ''}
                        </span>
                    </td>
                </tr>
            `).join('');
        }
    });

    // Helper function to get appropriate badge class based on job status
    function getStatusBadgeClass(status) {
        switch (status) {
            case 'RUN':
                return 'bg-success';
            case 'MSGW':
                return 'bg-warning';
            case 'LCKW':
            case 'DEQW':
            case 'DLYW':
                return 'bg-info';
            case 'END':
            case 'EOJ':
                return 'bg-danger';
            default:
                return 'bg-secondary';
        }
    }
});
