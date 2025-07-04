// LeetCode Tracker Frontend JavaScript

class TrackerAPI {
    constructor() {
        this.baseUrl = '/api'; // Will be served by our backend
    }

    async get(endpoint) {
        try {
            const response = await fetch(`${this.baseUrl}${endpoint}`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            console.error('API GET error:', error);
            throw error;
        }
    }

    async post(endpoint, data) {
        try {
            const response = await fetch(`${this.baseUrl}${endpoint}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data)
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            console.error('API POST error:', error);
            throw error;
        }
    }
}

const api = new TrackerAPI();

// DOM Elements
const alertElement = document.getElementById('alert');
const currentProblemsElement = document.getElementById('currentProblems');
const studyPositionElement = document.getElementById('studyPosition');
const unsolvedCountElement = document.getElementById('unsolvedCount');
const numProblemsInput = document.getElementById('numProblems');
const progressInfoElement = document.getElementById('progressInfo');

// Utility Functions
function showAlert(message, type = 'success') {
    alertElement.textContent = message;
    alertElement.className = `alert alert-${type}`;
    alertElement.style.display = 'block';
    
    // Don't auto-hide important messages
    if (!['info', 'warning'].includes(type)) {
        setTimeout(() => {
            alertElement.style.display = 'none';
        }, 5000);
    }
}

function hideAlert() {
    alertElement.style.display = 'none';
}

function formatDate(dateString) {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleDateString();
}

// Load initial data when page loads
document.addEventListener('DOMContentLoaded', async () => {
    console.log('LeetCode Tracker Frontend loaded');
    await refreshStatus();
});

// Main Functions
async function refreshStatus() {
    try {
        hideAlert();
        
        // Load settings and progress data
        const [settings, progress, status] = await Promise.all([
            api.get('/settings'),
            api.get('/progress'),
            api.get('/status')
        ]);

        updateUI(settings, progress, status);
        showAlert('Status refreshed successfully!', 'success');
        
    } catch (error) {
        console.error('Error refreshing status:', error);
        showAlert('Failed to refresh status. Make sure the backend is running.', 'error');
    }
}

function updateUI(settings, progress, status) {
    // Update settings
    numProblemsInput.value = settings.num_questions;
    currentProblemsElement.textContent = settings.num_questions;
    
    // Update progress
    studyPositionElement.textContent = `${progress.studyPlanPosition}/${status.totalProblems}`;
    
    const unsolvedProblems = progress.sentProblems.filter(p => !p.solved);
    unsolvedCountElement.textContent = unsolvedProblems.length;
    
    // Update progress info
    updateProgressInfo(progress, status);
}

function updateProgressInfo(progress, status) {
    let html = '';
    
    if (progress.lastSentDate) {
        html += `<h4>Last Activity: ${formatDate(progress.lastSentDate)}</h4>`;
        
        if (progress.sentProblems.length > 0) {
            const solvedCount = progress.sentProblems.filter(p => p.solved).length;
            const totalSent = progress.sentProblems.length;
            
            html += `
                <p><strong>Last Batch:</strong> ${solvedCount}/${totalSent} problems solved</p>
            `;
            
            if (progress.sentProblems.length <= 5) {
                html += '<ul class="problem-list">';
                progress.sentProblems.forEach(problem => {
                    const problemInfo = status.problemDetails[problem.slug] || { name: problem.slug };
                    const statusClass = problem.solved ? 'status-solved' : 'status-pending';
                    const statusText = problem.solved ? '✅ Solved' : '⏰ Pending';
                    
                    html += `
                        <li>
                            <span>${problemInfo.name}</span>
                            <span class="${statusClass}">${statusText}</span>
                        </li>
                    `;
                });
                html += '</ul>';
            }
        }
        
        if (progress.pendingQueue.length > 0) {
            html += `<p><strong>Pending Queue:</strong> ${progress.pendingQueue.length} problems waiting</p>`;
        }
    } else {
        html = '<p>No problems sent yet. The tracker will start on the next daily routine.</p>';
    }
    
    progressInfoElement.innerHTML = html;
}

async function updateSettings() {
    try {
        hideAlert();
        
        const numProblems = parseInt(numProblemsInput.value);
        
        if (isNaN(numProblems) || numProblems < 1 || numProblems > 10) {
            showAlert('Please enter a number between 1 and 10.', 'error');
            return;
        }
        
        const result = await api.post('/settings', {
            num_questions: numProblems
        });
        
        showAlert(`Settings updated! Now sending ${numProblems} problem${numProblems > 1 ? 's' : ''} per day.`, 'success');
        
        // Refresh the status after updating
        setTimeout(refreshStatus, 1000);
        
    } catch (error) {
        console.error('Error updating settings:', error);
        showAlert('Failed to update settings. Please try again.', 'error');
    }
}

async function testTracker() {
    try {
        hideAlert();
        showAlert('Running tracker test... This may take a few seconds.', 'success');
        
        const result = await api.post('/test', {});
        
        if (result.success) {
            showAlert('✅ Tracker test completed successfully!', 'success');
        } else {
            showAlert(`Test completed with issues: ${result.message}`, 'error');
        }
        
    } catch (error) {
        console.error('Error testing tracker:', error);
        showAlert('Test failed. Check the console for details.', 'error');
    }
}

async function runDailyCheck() {
    try {
        hideAlert();
        showAlert('Running daily check... This may take several minutes if the API needs to wake up.', 'success');
        
        const result = await api.post('/check', {});
        
        if (result.success) {
            const statusMessages = result.output.join('\n');
            showAlert(`✅ Daily check completed!\n\nLatest updates:\n${statusMessages}`, 'success');
            setTimeout(refreshStatus, 2000);
        } else {
            // Handle cold start and circuit breaker states
            if (result.coldStart) {
                switch (result.coldStart.status) {
                    case 'waking_up':
                        showAlert(
                            `The API is waking up from sleep mode (free tier). This can take 5-10 minutes.\n` +
                            `Try running the check again in a few minutes.\n\n` +
                            `Details:\n${result.output.join('\n')}`,
                            'info'
                        );
                        break;
                    case 'circuit_breaker':
                        showAlert(
                            `Too many failed attempts. The circuit breaker is active to prevent wasteful retries.\n` +
                            `Please wait 10 minutes before trying again.\n\n` +
                            `Details:\n${result.output.join('\n')}`,
                            'warning'
                        );
                        break;
                    default:
                        showAlert(`Check failed: ${result.message}\n\nDetails:\n${result.output.join('\n')}`, 'error');
                }
            } else {
                showAlert(`Check failed: ${result.message}\n\nDetails:\n${result.output.join('\n')}`, 'error');
            }
        }
        
    } catch (error) {
        console.error('Error running daily check:', error);
        showAlert('Daily check failed. Check the console for details.', 'error');
    }
}

// Keyboard shortcuts
document.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey) {
        switch (event.key) {
            case 's':
                event.preventDefault();
                updateSettings();
                break;
            case 'r':
                event.preventDefault();
                refreshStatus();
                break;
        }
    }
});

// Auto-refresh every 30 seconds
setInterval(async () => {
    try {
        const [settings, progress, status] = await Promise.all([
            api.get('/settings'),
            api.get('/progress'),
            api.get('/status')
        ]);
        updateUI(settings, progress, status);
    } catch (error) {
        // Silently fail on auto-refresh
        console.log('Auto-refresh failed:', error.message);
    }
}, 30000);