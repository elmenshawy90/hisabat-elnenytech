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
  const num = Number(amount) || 0;
  return new Intl.NumberFormat('ar-EG', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(num) + ' ج.م';
}

// ─── Format Balance Label ────────────────────────────────────
function formatBalanceLabel(balance) {
  if (balance === undefined || balance === null || isNaN(Number(balance))) {
    return {
      text: 'جاري التحميل...',
      colorClass: 'text-secondary'
    };
  }

  const num = Number(balance);

  if (num > 0) {
    return {
      text: `عليه ${formatCurrency(num)}`,
      colorClass: 'text-tertiary'
    };
  } else if (num < 0) {
    return {
      text: `له ${formatCurrency(Math.abs(num))}`,
      colorClass: 'text-green-600'
    };
  } else {
    return {
      text: 'متسدد بالكامل',
      colorClass: 'text-green-600'
    };
  }
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

// ─── Authentication & Session ────────────────────────────────
async function checkAuth() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok || res.status === 401) {
      window.location.href = '/login';
      return null;
    }
    const data = await res.json();
    if (!data.authenticated) {
      window.location.href = '/login';
      return null;
    }
    return data.user;
  } catch (err) {
    console.error('Auth check failed:', err);
    window.location.href = '/login';
    return null;
  }
}

async function logout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch (err) {
    console.error('Logout failed:', err);
  } finally {
    window.location.replace('/login');
  }
}

// Intercept fetch responses globally (if possible) or just do an initial check on load
// For pages requiring auth, they can just call checkAuth() on DOMContentLoaded

// ─── Input Validation ────────────────────────────────────────
// ─── Input Validation ────────────────────────────────────────
function setupPhoneValidation(inputId, errorId) {
  const input = document.getElementById(inputId);
  const errorMsg = document.getElementById(errorId);
  if (!input) return;

  input.maxLength = 15;

  const validate = () => {
    // Strip non-numbers
    let val = input.value.replace(/[^0-9]/g, '');
    input.value = val;

    let isError = false;
    let errorText = "";

    if (val.length > 0 && val.length < 8) {
      isError = true;
      errorText = "رقم الهاتف يجب أن يتكون من 8 أرقام على الأقل";
    }

    if (isError) {
      input.classList.add('border-error', 'focus:border-error', 'focus:ring-error');
      input.classList.remove('focus:border-primary', 'focus:ring-primary', 'border-outline-variant');
      if (errorMsg) {
        errorMsg.textContent = errorText;
        errorMsg.classList.remove('hidden');
      }
    } else {
      input.classList.remove('border-error', 'focus:border-error', 'focus:ring-error');
      input.classList.add('focus:border-primary', 'focus:ring-primary', 'border-outline-variant');
      if (errorMsg) errorMsg.classList.add('hidden');
    }
  };

  input.addEventListener('input', validate);
}

// ─── Text Normalization ─────────────────────────────────────
function normalizeArabic(text) {
    if (!text) return '';
    return text.toString().toLowerCase()
        .replace(/[\u064B-\u065F\u0670\u0640]/g, '') // remove Arabic tashkeel / harakat & tatweel
        .replace(/[أإآاٱ]/g, 'ا')
        .replace(/[ةه]/g, 'ه')
        .replace(/[ىي]/g, 'ي')
        .replace(/[ؤئء]/g, 'ء')
        .replace(/ـ/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// ─── Text Highlighting ─────────────────────────────────────
function highlightArabic(text, query) {
    if (!query || !text) return text;
    const rawTerms = query.toString().trim().split(/\s+/).filter(Boolean);
    if (rawTerms.length === 0) return text;

    const patterns = rawTerms.map(term => {
        let escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return escaped
            .replace(/[اأإآ]/g, '[اأإآ]')
            .replace(/[هة]/g, '[هة]')
            .replace(/[يى]/g, '[يى]')
            .replace(/[ءؤئ]/g, '[ءؤئ]');
    });

    try {
        const regex = new RegExp(`(${patterns.join('|')})`, 'gi');
        return text.toString().replace(regex, '<span class="bg-[#fef08a] text-black px-1 rounded-sm">$1</span>');
    } catch(e) {
        return text;
    }
}

// ─── Form Validation Helper ──────────────────────────────────
function validateFormFields(formId) {
    let hasEmpty = false;
    const form = document.getElementById(formId);
    if (!form) return hasEmpty;
    
    const requiredElements = form.querySelectorAll('input[required], textarea[required]');
    
    requiredElements.forEach(el => {
        if (!el.value.trim()) {
            el.classList.add('border-error');
            // Remove the red border once user types
            el.addEventListener('input', function removeError() {
                el.classList.remove('border-error');
                el.removeEventListener('input', removeError);
            });
            hasEmpty = true;
        } else {
            el.classList.remove('border-error');
        }
    });
    
    return hasEmpty;
}

// ─── Pagination Component Helper ────────────────────────────
function renderPaginationControls({
  containerId,
  infoId,
  currentPage,
  pageSize,
  totalRecords,
  unitLabel = 'عنصر',
  onPageChange
}) {
  const container = document.getElementById(containerId);
  const infoEl = document.getElementById(infoId);
  if (!container) return;

  const totalPages = Math.ceil(totalRecords / pageSize) || 1;
  const startRecord = totalRecords > 0 ? (currentPage - 1) * pageSize + 1 : 0;
  const endRecord = Math.min(currentPage * pageSize, totalRecords);

  if (infoEl) {
    infoEl.textContent = `عرض ${startRecord} - ${endRecord} من أصل ${totalRecords} ${unitLabel}`;
  }

  // Calculate visible page numbers
  let pages = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (currentPage > 3) pages.push('...');
    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 1, currentPage + 1);
    for (let i = start; i <= end; i++) {
      if (!pages.includes(i)) pages.push(i);
    }
    if (currentPage < totalPages - 2) pages.push('...');
    if (!pages.includes(totalPages)) pages.push(totalPages);
  }

  const prevDisabled = currentPage <= 1 ? 'disabled class="opacity-40 cursor-not-allowed"' : '';
  const nextDisabled = currentPage >= totalPages ? 'disabled class="opacity-40 cursor-not-allowed"' : '';

  let html = `
    <div class="flex items-center gap-1">
      <button ${prevDisabled} data-page="${currentPage - 1}" class="pagination-btn h-8 px-2.5 flex items-center justify-center rounded-lg border border-outline-variant bg-surface hover:bg-surface-container text-on-surface text-xs transition-all active:scale-95 disabled:hover:bg-surface">
        <span class="material-symbols-outlined text-base">chevron_right</span>
        <span class="mr-0.5 hidden sm:inline">السابق</span>
      </button>
  `;

  pages.forEach(p => {
    if (p === '...') {
      html += `<span class="px-2 text-secondary text-xs">...</span>`;
    } else {
      const isActive = p === currentPage;
      const activeClass = isActive
        ? 'bg-primary text-white font-bold border-primary shadow-xs'
        : 'bg-surface hover:bg-surface-container text-on-surface border-outline-variant';
      html += `
        <button data-page="${p}" class="pagination-btn h-8 min-w-[32px] px-2 flex items-center justify-center rounded-lg border text-xs transition-all active:scale-95 ${activeClass}">
          ${p}
        </button>
      `;
    }
  });

  html += `
      <button ${nextDisabled} data-page="${currentPage + 1}" class="pagination-btn h-8 px-2.5 flex items-center justify-center rounded-lg border border-outline-variant bg-surface hover:bg-surface-container text-on-surface text-xs transition-all active:scale-95 disabled:hover:bg-surface">
        <span class="ml-0.5 hidden sm:inline">التالي</span>
        <span class="material-symbols-outlined text-base">chevron_left</span>
      </button>
    </div>
  `;

  container.innerHTML = html;

  container.querySelectorAll('.pagination-btn:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = parseInt(btn.getAttribute('data-page'), 10);
      if (p && p !== currentPage && p >= 1 && p <= totalPages) {
        onPageChange(p);
      }
    });
  });
}

// ─── Disable Arrow Key Increment/Decrement & Mouse Wheel on Number Inputs ─────
document.addEventListener('keydown', function (e) {
  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.target && e.target.tagName === 'INPUT' && e.target.type === 'number') {
    e.preventDefault();
  }
});

document.addEventListener('wheel', function (e) {
  if (document.activeElement && document.activeElement.tagName === 'INPUT' && document.activeElement.type === 'number') {
    e.preventDefault();
  }
}, { passive: false });


