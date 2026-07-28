// ─── Toast Notifications ─────────────────────────────────────
function showToast(message, type = 'success') {
  // Remove existing toasts
  document.querySelectorAll('.toast-notification').forEach(t => t.remove());

  const toast = document.createElement('div');
  toast.className = 'toast-notification';

  const colors = {
    success: { bg: '#006840', icon: 'check_circle' },
    error: { bg: '#ba1a1a', icon: 'error' },
    info: { bg: '#585f6c', icon: 'info' },
    warning: { bg: '#953e43', icon: 'warning' }
  };

  const { bg, icon } = colors[type] || colors.info;

  toast.innerHTML = `
    <span class="material-symbols-outlined" style="font-size:20px;margin-left:8px;">${icon}</span>
    <span>${message}</span>
  `;

  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '80px',
    left: '50%',
    transform: 'translateX(-50%) translateY(20px)',
    backgroundColor: bg,
    color: '#fff',
    padding: '12px 24px',
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    zIndex: '9999',
    boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
    fontFamily: "'IBM Plex Sans Arabic', sans-serif",
    fontSize: '14px',
    opacity: '0',
    transition: 'all 0.3s ease',
    direction: 'rtl',
    maxWidth: '90vw'
  });

  document.body.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
  });

  // Auto remove after 3 seconds
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(20px)';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ─── Confirm Dialog ──────────────────────────────────────────
function showConfirm(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      backgroundColor: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: '10000',
      opacity: '0',
      transition: 'opacity 0.2s ease'
    });

    const dialog = document.createElement('div');
    dialog.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-direction:row-reverse;">
        <span class="material-symbols-outlined" style="color:#ba1a1a;font-size:28px;">warning</span>
        <p style="font-size:16px;color:#141b2b;font-weight:500;text-align:right;">${message}</p>
      </div>
      <div style="display:flex;gap:12px;justify-content:flex-start;">
        <button id="confirmYes" style="background:#ba1a1a;color:#fff;border:none;padding:10px 24px;border-radius:9999px;cursor:pointer;font-family:'IBM Plex Sans Arabic',sans-serif;font-size:14px;font-weight:600;transition:opacity 0.2s;">نعم، احذف</button>
        <button id="confirmNo" style="background:#fff;color:#141b2b;border:1px solid #becabf;padding:10px 24px;border-radius:9999px;cursor:pointer;font-family:'IBM Plex Sans Arabic',sans-serif;font-size:14px;font-weight:500;transition:background 0.2s;">إلغاء</button>
      </div>
    `;

    Object.assign(dialog.style, {
      backgroundColor: '#fff',
      borderRadius: '16px',
      padding: '24px',
      maxWidth: '400px',
      width: '90vw',
      boxShadow: '0 16px 48px rgba(0,0,0,0.15)',
      fontFamily: "'IBM Plex Sans Arabic', sans-serif",
      direction: 'rtl',
      transform: 'scale(0.95)',
      transition: 'transform 0.2s ease'
    });

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
      overlay.style.opacity = '1';
      dialog.style.transform = 'scale(1)';
    });

    const close = (result) => {
      overlay.style.opacity = '0';
      dialog.style.transform = 'scale(0.95)';
      setTimeout(() => {
        overlay.remove();
        resolve(result);
      }, 200);
    };

    dialog.querySelector('#confirmYes').addEventListener('click', () => close(true));
    dialog.querySelector('#confirmNo').addEventListener('click', () => close(false));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(false);
    });
  });
}

// ─── Loading Spinner ─────────────────────────────────────────
function showLoading(container) {
  const loader = document.createElement('div');
  loader.className = 'loading-spinner';
  loader.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:48px;">
      <div style="width:40px;height:40px;border:3px solid #becabf;border-top-color:#006840;border-radius:50%;animation:spin 0.8s linear infinite;"></div>
      <span style="color:#585f6c;font-size:14px;font-family:'IBM Plex Sans Arabic',sans-serif;">جاري التحميل...</span>
    </div>
  `;
  container.innerHTML = '';
  container.appendChild(loader);

  // Add spinner animation if not already added
  if (!document.querySelector('#spinnerStyle')) {
    const style = document.createElement('style');
    style.id = 'spinnerStyle';
    style.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`;
    document.head.appendChild(style);
  }
}

function hideLoading(container) {
  const loader = container.querySelector('.loading-spinner');
  if (loader) loader.remove();
}

// ─── Format Currency ─────────────────────────────────────────
function formatCurrency(amount) {
  return new Intl.NumberFormat('ar-EG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount) + ' ج.م';
}

// ─── Format Date ─────────────────────────────────────────────
function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}
