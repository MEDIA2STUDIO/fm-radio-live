// Admin Dashboard
async function init() {
  await loadStats();
  await loadUsers();
  await loadLiveBroadcasters();
}

function showSection(sectionId) {
  // Hide all sections
  document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));

  // Show selected section
  document.getElementById(sectionId).classList.add('active');

  // Update menu
  document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('active'));
  event.target.closest('.menu-item').classList.add('active');
}

async function loadStats() {
  try {
    const res = await fetch('/api/admin/stats');
    const data = await res.json();

    document.getElementById('totalUsers').textContent = data.stats.totalUsers;
    document.getElementById('totalBroadcasters').textContent = data.stats.totalBroadcasters;
    document.getElementById('activeBroadcasts').textContent = data.stats.activeBroadcasts;
    document.getElementById('totalBroadcasts').textContent = data.stats.totalBroadcasts;
  } catch (error) {
    console.error('Error loading stats:', error);
  }
}

async function loadUsers() {
  try {
    const res = await fetch('/api/admin/users');
    const data = await res.json();

    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = data.users.map(user => `
      <tr>
        <td>${user.id}</td>
        <td>${user.username}</td>
        <td>${user.email}</td>
        <td>${user.display_name || '-'}</td>
        <td>${user.location || '-'}</td>
        <td><span class="badge badge-${user.role === 'admin' ? 'danger' : 'success'}">${user.role}</span></td>
        <td><span class="badge badge-${user.status === 'active' ? 'success' : 'warning'}">${user.status}</span></td>
        <td>${user.is_live ? '<span class="badge badge-danger">LIVE</span>' : '-'}</td>
        <td>
          ${user.role !== 'admin' ? `
            <button onclick="deleteUser(${user.id})" class="btn btn-danger btn-sm">
              <i class="fas fa-trash"></i>
            </button>
          ` : ''}
        </td>
      </tr>
    `).join('');
  } catch (error) {
    console.error('Error loading users:', error);
  }
}

async function loadLiveBroadcasters() {
  try {
    const res = await fetch('/api/live');
    const data = await res.json();
    const container = document.getElementById('liveList');

    if (data.broadcasters.length === 0) {
      container.innerHTML = '<p class="no-listeners">No live broadcasts</p>';
      return;
    }

    container.innerHTML = data.broadcasters.map(b => `
      <div class="broadcaster-card">
        <div class="broadcaster-avatar">
          ${b.display_name ? b.display_name.charAt(0).toUpperCase() : 'R'}
        </div>
        <div class="broadcaster-info">
          <h3>${b.display_name || b.username}</h3>
          <p><i class="fas fa-map-marker-alt"></i> ${b.location || 'Unknown location'}</p>
          <p><i class="fas fa-headphones"></i> ${b.listeners} listeners</p>
        </div>
      </div>
    `).join('');
  } catch (error) {
    console.error('Error loading live broadcasters:', error);
  }
}

// Create user form
document.getElementById('createUserForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorDiv = document.getElementById('create-error');
  const successDiv = document.getElementById('create-success');
  errorDiv.style.display = 'none';
  successDiv.style.display = 'none';

  const formData = {
    username: document.getElementById('newUsername').value,
    email: document.getElementById('newEmail').value,
    password: document.getElementById('newPassword').value,
    displayName: document.getElementById('newDisplayName').value,
    location: document.getElementById('newLocation').value,
    role: document.getElementById('newRole').value
  };

  try {
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });

    const data = await res.json();

    if (data.success) {
      successDiv.textContent = 'User created successfully!';
      successDiv.style.display = 'block';
      e.target.reset();
      loadUsers();
      loadStats();
    } else {
      errorDiv.textContent = data.error || 'Failed to create user';
      errorDiv.style.display = 'block';
    }
  } catch (error) {
    errorDiv.textContent = 'Server error';
    errorDiv.style.display = 'block';
  }
});

async function deleteUser(userId) {
  if (!confirm('Are you sure you want to delete this user?')) return;

  try {
    await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
    loadUsers();
    loadStats();
  } catch (error) {
    alert('Error deleting user');
  }
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/';
}

// Initialize
init();

// Refresh live list every 5 seconds
setInterval(loadLiveBroadcasters, 5000);