// Global functions
function toggleMobileMenu() {
  document.querySelector('.nav-links').classList.toggle('active');
}

async function loadLiveBroadcasters() {
  try {
    const res = await fetch('/api/live');
    const data = await res.json();
    const container = document.getElementById('live-broadcasters');

    if (data.broadcasters.length === 0) {
      container.innerHTML = '<p class="no-broadcasts">No live broadcasts right now. Check back later!</p>';
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
          <p><i class="fas fa-headphones"></i> ${b.listeners} listening</p>
        </div>
        <a href="/listen?broadcaster=${b.id}" class="btn btn-primary btn-sm">
          <i class="fas fa-play"></i> Listen
        </a>
      </div>
    `).join('');
  } catch (error) {
    console.error('Error loading broadcasters:', error);
  }
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/';
}